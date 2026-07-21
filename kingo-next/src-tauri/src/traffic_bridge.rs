use std::{
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

#[derive(Clone, Default)]
pub struct BridgeRuntime {
    active: Arc<Mutex<Option<BridgeHandle>>>,
    download_total: Arc<AtomicU64>,
    upload_total: Arc<AtomicU64>,
}

struct BridgeHandle {
    stop: Arc<AtomicBool>,
}

impl BridgeRuntime {
    pub fn start(&self, socks_port: u16) -> Result<u16, String> {
        self.stop();
        self.download_total.store(0, Ordering::Relaxed);
        self.upload_total.store(0, Ordering::Relaxed);
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("本地代理转接启动失败：{error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("本地代理转接端口不可用：{error}"))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("本地代理转接配置失败：{error}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let download_total = self.download_total.clone();
        let upload_total = self.upload_total.clone();
        thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let download_total = download_total.clone();
                        let upload_total = upload_total.clone();
                        thread::spawn(move || {
                            let _ = stream.set_nonblocking(false);
                            if let Err(error) =
                                handle_client(stream, socks_port, download_total, upload_total)
                            {
                                eprintln!("[traffic-bridge] {error}");
                            }
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
        });
        *self.active.lock().map_err(|_| "本地代理转接状态不可用")? = Some(BridgeHandle { stop });
        Ok(port)
    }

    pub fn stop(&self) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(handle) = active.take() {
                handle.stop.store(true, Ordering::Relaxed);
            }
        }
    }

    pub fn traffic(&self) -> (u64, u64) {
        (
            self.download_total.load(Ordering::Relaxed),
            self.upload_total.load(Ordering::Relaxed),
        )
    }
}

fn handle_client(
    mut client: TcpStream,
    socks_port: u16,
    download_total: Arc<AtomicU64>,
    upload_total: Arc<AtomicU64>,
) -> Result<(), String> {
    client.set_read_timeout(Some(Duration::from_secs(8))).ok();
    let mut request = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 2048];
    while !request.windows(4).any(|value| value == b"\r\n\r\n") && request.len() < 65536 {
        let read = client
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(());
        }
        request.extend_from_slice(&buffer[..read]);
    }
    let header = String::from_utf8_lossy(&request);
    let first_line = header.lines().next().ok_or("HTTP 请求为空")?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().ok_or("HTTP 方法缺失")?;
    let destination = parts.next().ok_or("HTTP 目标缺失")?;
    let version = parts.next().unwrap_or("HTTP/1.1");
    let (host, port, path) = if method.eq_ignore_ascii_case("CONNECT") {
        let (host, port) = split_authority(destination, 443)?;
        (host, port, None)
    } else {
        let target = destination
            .strip_prefix("http://")
            .ok_or("仅支持 HTTP 和 HTTPS 代理请求")?;
        let slash = target.find('/').unwrap_or(target.len());
        let (host, port) = split_authority(&target[..slash], 80)?;
        let path = if slash == target.len() {
            "/"
        } else {
            &target[slash..]
        };
        (host, port, Some(path.to_string()))
    };
    let mut upstream = connect_socks5(socks_port, &host, port)?;
    if method.eq_ignore_ascii_case("CONNECT") {
        client
            .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
            .map_err(|error| error.to_string())?;
    } else {
        let end = request
            .windows(4)
            .position(|value| value == b"\r\n\r\n")
            .map(|index| index + 4)
            .ok_or("HTTP 请求头不完整")?;
        let line_end = request
            .windows(2)
            .position(|value| value == b"\r\n")
            .map(|index| index + 2)
            .ok_or("HTTP 请求行不完整")?;
        upstream
            .write_all(format!("{method} {} {version}\r\n", path.unwrap()).as_bytes())
            .map_err(|error| error.to_string())?;
        upstream
            .write_all(&request[line_end..end])
            .map_err(|error| error.to_string())?;
        if end < request.len() {
            upstream
                .write_all(&request[end..])
                .map_err(|error| error.to_string())?;
        }
    }
    relay(client, upstream, download_total, upload_total)
}

fn split_authority(authority: &str, default_port: u16) -> Result<(String, u16), String> {
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']').ok_or("IPv6 地址格式无效")?;
        let host = rest[..end].to_string();
        let port = rest[end + 1..]
            .strip_prefix(':')
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| "代理目标端口无效")?
            .unwrap_or(default_port);
        return Ok((host, port));
    }
    match authority.rsplit_once(':') {
        Some((host, value)) if !host.contains(':') => Ok((
            host.to_string(),
            value.parse().map_err(|_| "代理目标端口无效")?,
        )),
        _ => Ok((authority.to_string(), default_port)),
    }
}

fn connect_socks5(socks_port: u16, host: &str, port: u16) -> Result<TcpStream, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", socks_port))
        .map_err(|error| format!("SOCKS5 核心不可用：{error}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(8))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(8))).ok();
    stream
        .write_all(&[5, 1, 0])
        .map_err(|error| error.to_string())?;
    let mut hello = [0_u8; 2];
    stream
        .read_exact(&mut hello)
        .map_err(|error| error.to_string())?;
    if hello != [5, 0] {
        return Err("SOCKS5 核心拒绝无认证连接".into());
    }
    let host_bytes = host.as_bytes();
    if host_bytes.len() > 255 {
        return Err("代理目标域名过长".into());
    }
    let mut request = vec![5, 1, 0, 3, host_bytes.len() as u8];
    request.extend_from_slice(host_bytes);
    request.extend_from_slice(&port.to_be_bytes());
    stream
        .write_all(&request)
        .map_err(|error| error.to_string())?;
    let mut reply = [0_u8; 4];
    stream
        .read_exact(&mut reply)
        .map_err(|error| error.to_string())?;
    if reply[1] != 0 {
        return Err(format!("SOCKS5 连接目标失败，代码 {}", reply[1]));
    }
    let address_length = match reply[3] {
        1 => 4,
        3 => {
            let mut length = [0_u8; 1];
            stream
                .read_exact(&mut length)
                .map_err(|error| error.to_string())?;
            length[0] as usize
        }
        4 => 16,
        _ => return Err("SOCKS5 返回地址格式无效".into()),
    };
    let mut discard = vec![0_u8; address_length + 2];
    stream
        .read_exact(&mut discard)
        .map_err(|error| error.to_string())?;
    stream.set_read_timeout(None).ok();
    stream.set_write_timeout(None).ok();
    Ok(stream)
}

struct CountingReader<R> {
    inner: R,
    total: Arc<AtomicU64>,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let bytes = self.inner.read(buffer)?;
        self.total.fetch_add(bytes as u64, Ordering::Relaxed);
        Ok(bytes)
    }
}

fn relay(
    mut client: TcpStream,
    mut upstream: TcpStream,
    download_total: Arc<AtomicU64>,
    upload_total: Arc<AtomicU64>,
) -> Result<(), String> {
    let mut client_reader = client.try_clone().map_err(|error| error.to_string())?;
    let mut upstream_writer = upstream.try_clone().map_err(|error| error.to_string())?;
    let forward = thread::spawn(move || {
        let mut reader = CountingReader {
            inner: &mut client_reader,
            total: upload_total,
        };
        let _ = std::io::copy(&mut reader, &mut upstream_writer);
        let _ = upstream_writer.shutdown(Shutdown::Write);
    });
    let mut reader = CountingReader {
        inner: &mut upstream,
        total: download_total,
    };
    let _ = std::io::copy(&mut reader, &mut client);
    let _ = client.shutdown(Shutdown::Write);
    let _ = forward.join();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_tunnel_relays_through_socks5() {
        let echo = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let echo_address = echo.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = echo.accept().unwrap();
            let mut value = [0_u8; 4];
            stream.read_exact(&mut value).unwrap();
            assert_eq!(&value, b"ping");
            stream.write_all(b"pong").unwrap();
        });

        let socks = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let socks_port = socks.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut client, _) = socks.accept().unwrap();
            let mut hello = [0_u8; 3];
            client.read_exact(&mut hello).unwrap();
            assert_eq!(hello, [5, 1, 0]);
            client.write_all(&[5, 0]).unwrap();
            let mut request = [0_u8; 5];
            client.read_exact(&mut request).unwrap();
            assert_eq!(&request[..4], &[5, 1, 0, 3]);
            let mut domain_and_port = vec![0_u8; request[4] as usize + 2];
            client.read_exact(&mut domain_and_port).unwrap();
            let mut target = TcpStream::connect(echo_address).unwrap();
            client.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).unwrap();
            let mut client_reader = client.try_clone().unwrap();
            let mut target_writer = target.try_clone().unwrap();
            thread::spawn(move || {
                let _ = std::io::copy(&mut client_reader, &mut target_writer);
            });
            let _ = std::io::copy(&mut target, &mut client);
        });

        let bridge = BridgeRuntime::default();
        let bridge_port = bridge.start(socks_port).unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", bridge_port)).unwrap();
        client
            .write_all(b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n")
            .unwrap();
        let mut response = [0_u8; 39];
        client.read_exact(&mut response).unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));
        client.write_all(b"ping").unwrap();
        let mut pong = [0_u8; 4];
        client.read_exact(&mut pong).unwrap();
        assert_eq!(&pong, b"pong");
        bridge.stop();
    }
}
