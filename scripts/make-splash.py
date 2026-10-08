"""开屏图：中央用应用图标 resources/icon.png（白底，直接铺同色背景）"""
from PIL import Image, ImageDraw, ImageFont
import os, glob

ROOT = r'D:\DshReaderMobile'
RES = os.path.join(ROOT, 'resources')
ANDROID = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

icon = Image.open(os.path.join(RES, 'icon.png')).convert('RGBA')
BG = (255, 255, 255)


def load_font(size, bold=False):
    for p in [r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
              r'C:\Windows\Fonts\seguisb.ttf' if bold else r'C:\Windows\Fonts\segoeui.ttf']:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def make(w, h, icon_size):
    img = Image.new('RGB', (w, h), BG)
    ic = icon.resize((icon_size, icon_size), Image.LANCZOS)
    cx, cy = w // 2, h // 2 - int(icon_size * 0.16)
    img.paste(ic, (cx - icon_size // 2, cy - icon_size // 2), ic)
    d = ImageDraw.Draw(img)
    f1 = load_font(int(icon_size * 0.26), bold=True)
    f2 = load_font(int(icon_size * 0.13))
    t = 'Dsh Reader'
    d.text((w / 2 - d.textlength(t, font=f1) / 2, cy + icon_size // 2 + int(icon_size * 0.20)), t, font=f1, fill=(31, 41, 55))
    s = 'EPUB 阅读器'
    d.text((w / 2 - d.textlength(s, font=f2) / 2, cy + icon_size // 2 + int(icon_size * 0.52)), s, font=f2, fill=(130, 140, 155))
    return img


port = make(1080, 1920, 460)
port.save(os.path.join(RES, 'splash.png'))
port.resize((405, 720)).save(os.path.join(RES, 'splash-preview.png'))
land = make(1920, 1080, 400)
land.save(os.path.join(RES, 'splash-land.png'))

n = 0
for folder in glob.glob(os.path.join(ANDROID, 'drawable*')):
    target = os.path.join(folder, 'splash.png')
    if not os.path.exists(target):
        continue
    (land if 'land' in os.path.basename(folder) else port).save(target)
    n += 1
print('  开屏图已重做，替换 Android', n, '张')
