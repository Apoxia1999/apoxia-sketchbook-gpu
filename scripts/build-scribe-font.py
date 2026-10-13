"""Generate Scribe vector outlines with FontTools (development dependency)."""
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen

root = Path(__file__).resolve().parents[1]
font = TTFont(root / 'assets/PaperMono-Regular.otf')
glyphs = font.getGlyphSet()
class OutlinePen(BasePen):
    def __init__(self):
        super().__init__(glyphs)
        self.commands = []
    def _moveTo(self, p): self.commands.append(['M', p[0], -p[1]])
    def _lineTo(self, p): self.commands.append(['L', p[0], -p[1]])
    def _curveToOne(self, a, b, c): self.commands.append(['C', a[0], -a[1], b[0], -b[1], c[0], -c[1]])
    def _qCurveToOne(self, a, b): self.commands.append(['Q', a[0], -a[1], b[0], -b[1]])
    def _closePath(self): self.commands.append(['Z'])
    def _endPath(self): self.commands.append(['Z'])
chars = {}
for code, name in font.getBestCmap().items():
    pen = OutlinePen()
    glyphs[name].draw(pen)
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    box = bounds.bounds
    chars[code] = {'a': font['hmtx'][name][0], 'c': pen.commands, 'b': [box[0], -box[3], box[2], -box[1]] if box else None}
kern = {}
by_name = {}
for code, name in font.getBestCmap().items(): by_name.setdefault(name, []).append(code)
# Extract pair spacing when the font supplies a kern feature.
if 'GPOS' in font:
    lookups = font['GPOS'].table.LookupList.Lookup
    indices = {index for record in font['GPOS'].table.FeatureList.FeatureRecord if record.FeatureTag == 'kern' for index in record.Feature.LookupListIndex}
    for index in sorted(indices):
        lookup = lookups[index]
        if lookup.LookupType != 2: continue
        for table in lookup.SubTable:
            if table.Format != 1: raise ValueError('Unsupported kerning format')
            for name, pairs in zip(table.Coverage.glyphs, table.PairSet):
                for pair in pairs.PairValueRecord:
                    adjustment = getattr(pair.Value1, 'XAdvance', 0) if pair.Value1 else 0
                    for first in by_name.get(name, []):
                        for second in by_name.get(pair.SecondGlyph, []):
                            key = f'{first},{second}'
                            kern[key] = kern.get(key, 0) + adjustment
(root / 'assets/paper-mono-outlines.json').write_text(json.dumps({'units': font['head'].unitsPerEm, 'chars': chars, 'kern': kern}, separators=(',', ':')))
