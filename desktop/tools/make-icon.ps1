# MixMark · 生成 Windows 图标（.ico）
# ===============================================================
#   powershell -ExecutionPolicy Bypass -File desktop/tools/make-icon.ps1
#
# 为什么用 PowerShell 而不是 Node：
#   要生成多尺寸的 .ico，就得把 1800x1800 的原图缩到 16/32/48/256……
#   而 Node 侧没有任何图像处理依赖（本项目运行期零构建，也不想为此引一个）。
#   System.Drawing 是 Windows 自带的，缩图质量足够，且这一步只在发版前跑一次。
#
# 为什么不是「一个尺寸的 ico」：
#   任务栏、开始菜单、文件管理器小图标、安装器大图用的是不同尺寸。
#   只放 256 的话，Windows 会拿它硬缩到 16，细节会糊成一团。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # → 仓库根
# 母图就用应用里那张 logo —— 同一张图只存一份，换图时也只改一处
$src  = Join-Path $root 'web\assets\logo.png'
$outDir = Join-Path $root 'desktop\build'
$outIco = Join-Path $outDir 'icon.ico'
$outPng = Join-Path $outDir 'icon.png'

if (-not (Test-Path $src)) { throw "找不到原图：$src" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# ICO 里要装的尺寸。256 是安装器与「大图标」视图用的
$sizes = @(16, 24, 32, 48, 64, 128, 256)

$master = [System.Drawing.Image]::FromFile($src)
Write-Host ("原图 {0}x{1}" -f $master.Width, $master.Height)

function Resize-Png {
    param([System.Drawing.Image]$Img, [int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        # 描边留一点余量：方形图标直接顶到边缘，小尺寸下会显得糊成一坨
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($Img, 0, 0, $Size, $Size)
    } finally {
        $g.Dispose()
    }

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return $ms.ToArray()
}

# 顺手存一份 256 的 png：Linux 打包目标与 README 用得上
[System.IO.File]::WriteAllBytes($outPng, (Resize-Png -Img $master -Size 256))

$blobs = @()
foreach ($s in $sizes) { $blobs += ,(Resize-Png -Img $master -Size $s) }
$master.Dispose()

# --- 组装 ICO 容器 ---
# ICONDIR(6) + ICONDIRENTRY*N(16) + 各尺寸的 PNG 数据。
# Vista 以后允许条目直接放 PNG（不必是 BMP），省掉一堆调色板与掩码的活
$count = $sizes.Count
$headerSize = 6 + 16 * $count

# 头部按字节手工拼（小端）。
# 这里刻意不用 BinaryWriter：$bw.Write($byteArray) 在 PowerShell 里会被
# 选到「写单个 byte」的重载上 —— 7 个图块最后只写进 7 个字节，
# 得到一个看起来正常、实际没有任何图像数据的 ico。
$head = New-Object 'System.Collections.Generic.List[byte]'
$head.Add(0); $head.Add(0)          # reserved
$head.Add(1); $head.Add(0)          # type = 1 (icon)
$head.Add([byte]($count -band 0xFF)); $head.Add([byte](($count -shr 8) -band 0xFF))

function Add-U32 {
    param([System.Collections.Generic.List[byte]]$List, [UInt32]$Value)
    for ($i = 0; $i -lt 4; $i++) { $List.Add([byte](($Value -shr (8 * $i)) -band 0xFF)) }
}

$offset = $headerSize
for ($i = 0; $i -lt $count; $i++) {
    $size = $sizes[$i]
    # 256 在这一个字节里写不下，约定俗成用 0 表示
    $dim = if ($size -ge 256) { 0 } else { $size }
    $head.Add([byte]$dim)           # width
    $head.Add([byte]$dim)           # height
    $head.Add(0)                    # 调色板颜色数（PNG 条目不用）
    $head.Add(0)                    # reserved
    $head.Add(1); $head.Add(0)      # color planes = 1
    $head.Add(32); $head.Add(0)     # bits per pixel = 32
    Add-U32 -List $head -Value ([UInt32]$blobs[$i].Length)
    Add-U32 -List $head -Value ([UInt32]$offset)
    $offset += $blobs[$i].Length
}

# 用 Write(byte[], int, int) 这个三参重载：没有歧义
$ms = New-Object System.IO.MemoryStream
$headBytes = $head.ToArray()
$ms.Write($headBytes, 0, $headBytes.Length)
foreach ($b in $blobs) { $ms.Write($b, 0, $b.Length) }
[System.IO.File]::WriteAllBytes($outIco, $ms.ToArray())
$ms.Dispose()

if ((Get-Item $outIco).Length -le $headerSize) {
    throw "ico 只有头部、没有图像数据（{0} 字节）—— 别急着把它打进安装包" -f (Get-Item $outIco).Length
}

Write-Host ("已生成 {0}（{1} 个尺寸，{2} KB）" -f $outIco, $count, [math]::Round((Get-Item $outIco).Length / 1KB, 1))
Write-Host ("已生成 {0}" -f $outPng)
