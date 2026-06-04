import * as http from 'http'

let server: http.Server | null = null

// Common China-side domains for rule mode (direct connection)
const CN_DOMAINS = [
  '*.cn', '*.com.cn', '*.org.cn', '*.net.cn',
  '*.taobao.com', '*.tmall.com', '*.jd.com', '*.baidu.com',
  '*.qq.com', '*.weixin.com', '*.wechat.com', '*.sina.com.cn',
  '*.163.com', '*.126.com', '*.sohu.com', '*.bilibili.com',
  '*.zhihu.com', '*.douyin.com', '*.kuaishou.com', '*.ixigua.com',
  '*.aliyun.com', '*.huawei.com', '*.xiaomi.com', '*.meituan.com',
  '*.ctrip.com', '*.didiglobal.com', '*.pinduoduo.com'
]

function generatePac(proxyHost: string, proxyPort: number, _protocol: string, mode: 'global' | 'rule'): string {
  // Use standard "SOCKS" directive (not "SOCKS5") for broader PAC compatibility
  const proxyStr = `SOCKS ${proxyHost}:${proxyPort}`

  if (mode === 'global') {
    return `function FindProxyForURL(url, host) { return "${proxyStr}"; }`
  }

  // Rule mode: direct for China domains, proxy for everything else
  const directList = CN_DOMAINS.map((d) => `"${d}"`).join(', ')
  return `function FindProxyForURL(url, host) {
  var direct = [${directList}];
  for (var i = 0; i < direct.length; i++) {
    if (shExpMatch(host, direct[i])) return "DIRECT";
  }
  return "${proxyStr}";
}`
}

export function startPacServer(
  proxyHost: string,
  proxyPort: number,
  protocol: string,
  mode: 'global' | 'rule'
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Stop any existing server first
    stopPacServer()

    const pacContent = generatePac(proxyHost, proxyPort, protocol, mode)

    server = http.createServer((req, res) => {
      if (req.url === '/proxy.pac' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' })
        res.end(pacContent)
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    server.on('error', (err) => {
      server = null
      reject(err)
    })

    // Use port 0 to let OS pick a free port, then resolve with actual port
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      if (addr && typeof addr === 'object') {
        resolve(addr.port)
      } else {
        reject(new Error('Failed to get server address'))
      }
    })
  })
}

export function stopPacServer(): void {
  if (server) {
    server.close()
    server = null
  }
}

export function isPacServerRunning(): boolean {
  return server !== null && server.listening
}
