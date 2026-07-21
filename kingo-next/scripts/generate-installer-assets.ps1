Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path $root 'src\assets\kingo-logo.png'
$iconDir = Join-Path $root 'src-tauri\icons'
$outputDir = Join-Path $root 'src-tauri\installer'
New-Item -ItemType Directory -Force -Path $iconDir, $outputDir | Out-Null

$logo = [System.Drawing.Image]::FromFile($logoPath)
$fontFamily = New-Object System.Drawing.FontFamily('Microsoft YaHei UI')

function New-Canvas([int]$width, [int]$height, [bool]$transparent = $false) {
  $format = if ($transparent) {
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  } else {
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  }
  return New-Object System.Drawing.Bitmap($width, $height, $format)
}

function New-Graphics([System.Drawing.Bitmap]$bitmap) {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  return $graphics
}

function Draw-ContainedImage(
  [System.Drawing.Graphics]$graphics,
  [System.Drawing.Image]$image,
  [float]$x,
  [float]$y,
  [float]$width,
  [float]$height
) {
  $scale = [Math]::Min($width / $image.Width, $height / $image.Height)
  $drawWidth = [float]($image.Width * $scale)
  $drawHeight = [float]($image.Height * $scale)
  $drawX = [float]($x + (($width - $drawWidth) / 2))
  $drawY = [float]($y + (($height - $drawHeight) / 2))
  $graphics.DrawImage($image, $drawX, $drawY, $drawWidth, $drawHeight)
}

function Save-Bmp([System.Drawing.Bitmap]$bitmap, [string]$name) {
  $path = Join-Path $outputDir $name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bitmap.Dispose()
}

$dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(18, 45, 69))
$blue = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(31, 137, 188))
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 105, 128))
$accentPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(96, 190, 224), 2)
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(218, 235, 244), 1)
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center
$center.LineAlignment = [System.Drawing.StringAlignment]::Center
$titleFont = New-Object System.Drawing.Font($fontFamily, 23, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$headerFont = New-Object System.Drawing.Font($fontFamily, 16, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$bodyFont = New-Object System.Drawing.Font($fontFamily, 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

# Add transparent breathing room so Windows never clips the round mark in the
# taskbar, shortcuts, installer title bar, or high-DPI icon variants.
$appIcon = New-Canvas 512 512 $true
$graphics = New-Graphics $appIcon
$graphics.Clear([System.Drawing.Color]::Transparent)
Draw-ContainedImage $graphics $logo 32 32 448 448
$graphics.Dispose()
$appIcon.Save((Join-Path $iconDir 'app-icon-source.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$appIcon.Dispose()

# NSIS welcome and completion artwork (164 x 314).
$sidebar = New-Canvas 164 314
$graphics = New-Graphics $sidebar
$rect = New-Object System.Drawing.Rectangle(0, 0, 164, 314)
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(248, 253, 255),
  [System.Drawing.Color]::FromArgb(201, 235, 249),
  90
)
$graphics.FillRectangle($gradient, $rect)
$graphics.DrawLine($accentPen, 45, 18, 119, 18)
Draw-ContainedImage $graphics $logo 34 34 96 96
$graphics.DrawString('KiNGO', $titleFont, $dark, (New-Object System.Drawing.RectangleF(0, 147, 164, 34)), $center)
$graphics.DrawLine($accentPen, 50, 190, 114, 190)
$graphics.DrawString('WINDOWS CLIENT', $bodyFont, $muted, (New-Object System.Drawing.RectangleF(0, 201, 164, 20)), $center)
$graphics.DrawString('VERSION 2.0', $bodyFont, $blue, (New-Object System.Drawing.RectangleF(0, 222, 164, 20)), $center)
$graphics.Dispose()
$gradient.Dispose()
Save-Bmp $sidebar 'nsis-sidebar.bmp'

# NSIS page header (150 x 57). Keep generous margins around both wordmark and icon.
$header = New-Canvas 150 57
$graphics = New-Graphics $header
$graphics.Clear([System.Drawing.Color]::White)
$graphics.DrawString('KiNGO', $headerFont, $blue, 12, 18)
Draw-ContainedImage $graphics $logo 101 7 42 42
$graphics.DrawLine($borderPen, 0, 56, 150, 56)
$graphics.Dispose()
Save-Bmp $header 'nsis-header.bmp'

# WiX artwork remains available for future MSI builds, using the same safe areas.
$dialog = New-Canvas 493 312
$graphics = New-Graphics $dialog
$graphics.Clear([System.Drawing.Color]::White)
$left = New-Object System.Drawing.Rectangle(0, 0, 164, 312)
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $left,
  [System.Drawing.Color]::FromArgb(248, 253, 255),
  [System.Drawing.Color]::FromArgb(201, 235, 249),
  90
)
$graphics.FillRectangle($gradient, $left)
$graphics.DrawLine($accentPen, 45, 18, 119, 18)
Draw-ContainedImage $graphics $logo 34 34 96 96
$graphics.DrawString('KiNGO', $titleFont, $dark, (New-Object System.Drawing.RectangleF(0, 147, 164, 34)), $center)
$graphics.DrawLine($accentPen, 50, 190, 114, 190)
$graphics.DrawString('WINDOWS CLIENT', $bodyFont, $muted, (New-Object System.Drawing.RectangleF(0, 201, 164, 20)), $center)
$graphics.DrawString('VERSION 2.0', $bodyFont, $blue, (New-Object System.Drawing.RectangleF(0, 222, 164, 20)), $center)
$graphics.Dispose()
$gradient.Dispose()
Save-Bmp $dialog 'wix-dialog.bmp'

$banner = New-Canvas 493 58
$graphics = New-Graphics $banner
$graphics.Clear([System.Drawing.Color]::White)
$graphics.DrawLine($borderPen, 0, 57, 493, 57)
Draw-ContainedImage $graphics $logo 440 7 42 42
$graphics.Dispose()
Save-Bmp $banner 'wix-banner.bmp'

$titleFont.Dispose()
$headerFont.Dispose()
$bodyFont.Dispose()
$dark.Dispose()
$blue.Dispose()
$muted.Dispose()
$accentPen.Dispose()
$borderPen.Dispose()
$center.Dispose()
$fontFamily.Dispose()
$logo.Dispose()
