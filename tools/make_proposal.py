"""Proposal PDF (2 pages, A4 landscape, black) + portfolio merge. Usage: python make_proposal.py <key>"""
import io, sys, textwrap
from PIL import Image
from reportlab.lib.pagesizes import landscape, A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter

ROOT = r"C:\VS Code\petri-mold"
DISH = ROOT + r"\temp\screens-2026-10\3.png"
MOCK = ROOT + r"\temp\mockups-monitor\preview.png"
PORTFOLIO = ROOT + r"\docs\press\OGOxWOW_portfolio_2026_EN.pdf"

LINKS = [
    "Playable work: https://dariyxyz.github.io/petri-mold/",
    "Video: https://www.youtube.com/watch?v=2gKaos4EKko",
    "Presentation: https://dariyxyz.github.io/petri-mold/docs/portfolio/",
    "Media: https://drive.google.com/drive/folders/1zaVo7N3MKv_c3ov3awPn4IomXxDs-FVz",
]
CONTACT = "Darius Nazarov / OGOxWOW Buro / Belgrade, Serbia / ogowow.buro@gmail.com / @ogowow_buro"

STATEMENT = (
    "I studied different types of mold in courses and encounter it frequently in everyday life. "
    "I am unsettled by the invisible world that quietly consumes what surrounds us. Digitization and "
    "play are my way of working through that feeling: by breaking a natural process down and observing "
    "it closely, I can begin to make peace with it. Mold.log gives this method a form. The Petri dish "
    "becomes a contained space in which fear turns into curiosity: the image is monochrome and available "
    "for inspection, and the process can be paused, burned away and started again."
)
WORK = (
    "Mold.log (2026) is a browser-based generative work. Visitors place spores in a virtual Petri dish; "
    "twelve strains grow as rings, dendrites, filaments and clusters, compete for nutrients and slowly "
    "take over the dish. The sound is generated from the visible growth and layers into a quiet polyphonic "
    "soundscape. A BURN action clears the dish and the cycle starts again. Mold.log has not been exhibited yet."
)

CALLS = {
    "swimmingpool": dict(
        out=ROOT + r"\docs\applications\Mold.log_THRESHOLD_SwimmingPoolGallery_Darius_Nazarov.pdf",
        title="Mold.log — proposal for THRESHOLD",
        venue="Swimming Pool Gallery, Berlin — Open Call 2027",
        proposal=(
            "A Petri dish is a threshold object: a sealed, sterile world in which something living appears "
            "and turns the clean surface into another condition. Mold.log stays exactly on that line: between "
            "the living and the simulated, between the biological process and its digital record, between "
            "fascination and contamination. Every cycle shows one state shifting into another, until the dish "
            "is burned and returns to zero.\n\n"
            "For the window of Swimming Pool Gallery I propose a single screen facing the street. The dish "
            "grows continuously in an autonomous mode: spores are seeded at random, colonies fill the glass, "
            "the dish burns and the cycle repeats. Passers-by meet a slow living image behind glass, a second "
            "threshold between the street and the work. During opening hours a mouse inside lets visitors start "
            "their own experiment; a small speaker at low volume carries the sound."
        ),
        tech=(
            "Technical: one monitor or TV (from 24\"), a small computer running a web browser, optional mouse "
            "and speaker. The work opens from a single link; installation is remote and takes about one hour "
            "with the gallery team, de-installation 15 minutes. No living material is involved. Equipment can "
            "be adapted to what the gallery has."
        ),
    ),
    "bazis": dict(
        out=ROOT + r"\docs\applications\Mold.log_UNDERGROUND_Bazis_Darius_Nazarov.pdf",
        title="Mold.log — project for UNDERGROUND",
        venue="Bázis., Budapest — Open Call: Underground (Jan–Feb 2027)",
        proposal=(
            "Mold lives in the underground of everyday life: in basements, behind walls, under surfaces, in "
            "places we do not look at. Its growth is a hidden economy of competition for food and space that "
            "becomes visible only when it is already everywhere. Mold.log brings this underground process to "
            "the surface and slows it down for observation.\n\n"
            "Project: a dark room with one observation station. A monitor on a plinth shows the virtual Petri "
            "dish; visitors use a mouse to place spores and watch twelve strains grow, meet and consume each "
            "other. Sound generated from the visible growth fills the room at low volume. On the walls, a series "
            "of prints of dishes grown in the work (A3 or smaller, printed locally from files) works as a record "
            "of past experiments."
        ),
        tech=(
            "Installation plan: plinth or small desk with monitor (from 24\"), computer with web browser, mouse, "
            "stereo speakers or a small speaker; 3–6 prints on the wall, printed locally. Approximate space: "
            "2 x 3 m, dimmed light. Installation is remote via one link (about one hour with the venue team), "
            "de-installation 15 minutes. Participating artist: Darius Nazarov (individual author, OGOxWOW Buro)."
        ),
    ),
}


def jpeg(path, w=1100):
    im = Image.open(path).convert("RGB")
    im.thumbnail((w, w))
    b = io.BytesIO(); im.save(b, "JPEG", quality=70); b.seek(0)
    return ImageReader(b)


def para(c, text, x, y, width_chars, size=10, lead=14, color=(0.9, 0.9, 0.9)):
    c.setFont("Helvetica", size); c.setFillColorRGB(*color)
    for block in text.split("\n"):
        for line in (textwrap.wrap(block, width_chars) or [""]):
            c.drawString(x, y, line); y -= lead
    return y


def build(key):
    cfg = CALLS[key]
    W, H = landscape(A4)
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=(W, H))
    # page 1: proposal
    c.setFillColorRGB(0.1, 0.1, 0.1); c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColorRGB(0.95, 0.95, 0.95); c.setFont("Helvetica-Bold", 20); c.drawString(40, H - 55, cfg["title"])
    c.setFont("Helvetica", 10); c.setFillColorRGB(0.6, 0.6, 0.6); c.drawString(40, H - 75, cfg["venue"])
    c.drawImage(jpeg(DISH), W - 330, H - 400, 290, 290, preserveAspectRatio=True)
    y = para(c, cfg["proposal"], 40, H - 110, 82)
    para(c, cfg["tech"], 40, y - 14, 82, size=9, lead=12, color=(0.7, 0.7, 0.7))
    c.setFont("Helvetica", 8); c.setFillColorRGB(0.5, 0.5, 0.5); c.drawString(40, 28, CONTACT)
    c.showPage()
    # page 2: work + statement + links
    c.setFillColorRGB(0.1, 0.1, 0.1); c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColorRGB(0.95, 0.95, 0.95); c.setFont("Helvetica-Bold", 14); c.drawString(40, H - 55, "The work")
    y = para(c, WORK, 40, H - 80, 70)
    c.setFillColorRGB(0.95, 0.95, 0.95); c.setFont("Helvetica-Bold", 14); c.drawString(40, y - 20, "Artist statement")
    y = para(c, STATEMENT, 40, y - 45, 70)
    c.setFillColorRGB(0.95, 0.95, 0.95); c.setFont("Helvetica-Bold", 14); c.drawString(40, y - 20, "Links")
    para(c, "\n".join(LINKS), 40, y - 45, 120, size=9, lead=13)
    c.drawImage(jpeg(MOCK), W - 360, 120, 320, 320, preserveAspectRatio=True)
    c.setFont("Helvetica", 8); c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawString(40, 28, CONTACT + "   —   portfolio follows")
    c.save(); buf.seek(0)
    w = PdfWriter()
    for p in PdfReader(buf).pages: w.add_page(p)
    for p in PdfReader(PORTFOLIO).pages: w.add_page(p)
    with open(cfg["out"], "wb") as f: w.write(f)
    print(cfg["out"])


if __name__ == "__main__":
    for k in sys.argv[1:]: build(k)
