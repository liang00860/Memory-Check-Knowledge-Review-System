from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import black, red
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


output_dir = Path.cwd() / "tmp" / "pdfs"
output_dir.mkdir(parents=True, exist_ok=True)
output_path = output_dir / "red-knowledge.pdf"

document = canvas.Canvas(str(output_path), pagesize=(612, 792))
document.setFont("Helvetica-Bold", 22)
document.setFillColor(red)
document.drawString(72, 680, "Spaced repetition")
document.setFont("Helvetica", 14)
document.setFillColor(black)
document.drawString(72, 648, "improves long-term retention by spacing review sessions over time.")
document.save()

scan_image_path = output_dir / "red-scan-source.png"
scan_image = Image.new("RGB", (1200, 760), "white")
draw = ImageDraw.Draw(scan_image)
font_path = Path("C:/Windows/Fonts/arial.ttf")
bold_font_path = Path("C:/Windows/Fonts/arialbd.ttf")
heading_font = ImageFont.truetype(str(bold_font_path), 72)
body_font = ImageFont.truetype(str(font_path), 42)
draw.text((100, 180), "Active recall", fill=(255, 0, 0), font=heading_font)
draw.text(
    (100, 300),
    "strengthens memory by retrieving knowledge without notes.",
    fill=(0, 0, 0),
    font=body_font,
)
scan_image.save(scan_image_path)

scan_pdf_path = output_dir / "red-scan.pdf"
scan_document = canvas.Canvas(str(scan_pdf_path), pagesize=(612, 792))
scan_document.drawImage(
    ImageReader(scan_image),
    54,
    360,
    width=504,
    height=319.2,
    preserveAspectRatio=True,
    mask="auto",
)
scan_document.save()

print(output_path)
print(scan_pdf_path)
