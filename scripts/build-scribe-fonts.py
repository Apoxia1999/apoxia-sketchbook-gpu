"""Rebuild every bundled Scribe outline table (requires FontTools)."""
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[1]
fonts = [('PatrickHand','patrick-hand'),('GloriaHallelujah','gloria-hallelujah'),('NanumBrushScript','nanum-brush-script'),('LondrinaSolid','londrina-solid'),('MetalMania','metal-mania'),('GoogleSans','google-sans')]
for filename, slug in fonts:
    suffix = '.json' if slug == 'patrick-hand' else '.json.gz'
    subprocess.run([sys.executable, str(root / 'scripts/build-scribe-font.py'), f'assets/{filename}-Regular.ttf', f'assets/{slug}-outlines{suffix}'], cwd=root, check=True)
