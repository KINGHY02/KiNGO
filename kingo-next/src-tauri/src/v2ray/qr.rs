use image::{DynamicImage, GrayImage};

fn decode_gray(image: GrayImage) -> Vec<String> {
    let mut prepared = rqrr::PreparedImage::prepare(image);
    prepared
        .detect_grids()
        .into_iter()
        .filter_map(|grid| grid.decode().ok().map(|(_, content)| content))
        .filter(|content| !content.trim().is_empty())
        .collect()
}

pub fn decode_image(bytes: &[u8]) -> Result<Vec<String>, String> {
    let image =
        image::load_from_memory(bytes).map_err(|error| format!("无法读取二维码图片：{error}"))?;
    let results = decode_gray(image.to_luma8());
    if results.is_empty() {
        Err("图片中没有识别到有效二维码".into())
    } else {
        Ok(results)
    }
}

pub fn scan_screens() -> Result<Vec<String>, String> {
    let monitors = xcap::Monitor::all().map_err(|error| format!("无法获取显示器：{error}"))?;
    let mut results = Vec::new();
    for monitor in monitors {
        let image = monitor
            .capture_image()
            .map_err(|error| format!("截取屏幕失败：{error}"))?;
        results.extend(decode_gray(DynamicImage::ImageRgba8(image).to_luma8()));
    }
    results.sort();
    results.dedup();
    if results.is_empty() {
        Err("屏幕中没有识别到有效二维码".into())
    } else {
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;
    use qrcode::{types::Color, QrCode};

    #[test]
    fn decodes_generated_qr_image() {
        let content = "vless://demo@example.com:443#KiNGO";
        let code = QrCode::new(content.as_bytes()).expect("create QR");
        let scale = 8;
        let quiet = 4;
        let size = (code.width() + quiet * 2) * scale;
        let mut image = GrayImage::from_pixel(size as u32, size as u32, Luma([255]));
        for y in 0..code.width() {
            for x in 0..code.width() {
                if code[(x, y)] == Color::Dark {
                    for py in 0..scale {
                        for px in 0..scale {
                            image.put_pixel(
                                ((x + quiet) * scale + px) as u32,
                                ((y + quiet) * scale + py) as u32,
                                Luma([0]),
                            );
                        }
                    }
                }
            }
        }
        assert_eq!(decode_gray(image), vec![content]);
    }
}
