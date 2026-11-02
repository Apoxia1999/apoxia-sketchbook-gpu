"""Generate Scribe vector outlines with FontTools (development dependency)."""
import json
import gzip
import argparse
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('font', nargs='?', default='assets/PatrickHand-Regular.ttf')
parser.add_argument('output', nargs='?', default='assets/patrick-hand-outlines.json')
args = parser.parse_args()
font = TTFont(root / args.font)
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
# Use the Latin default language system, rather than mixing kerning rules from
# unrelated writing systems. Support both explicit pairs and class-based pairs.
if 'GPOS' in font:
    table = font['GPOS'].table
    records = table.FeatureList.FeatureRecord
    scripts = {r.ScriptTag: r.Script for r in table.ScriptList.ScriptRecord}
    script = scripts.get('latn') or scripts.get('DFLT')
    features = script.DefaultLangSys.FeatureIndex if script and script.DefaultLangSys else range(len(records))
    indices = {i for n in features if records[n].FeatureTag == 'kern' for i in records[n].Feature.LookupListIndex}
    def add_pair(first, second, adjustment):
        if not adjustment: return
        for a in by_name.get(first, []):
            for b in by_name.get(second, []):
                key = f'{a},{b}'
                kern[key] = kern.get(key, 0) + adjustment
    for index in sorted(indices):
        lookup = table.LookupList.Lookup[index]
        for original in lookup.SubTable:
            kind = lookup.LookupType
            sub = original
            if kind == 9:
                kind, sub = original.ExtensionLookupType, original.ExtSubTable
            if kind != 2: continue
            if sub.Format == 1:
                for first, pairs in zip(sub.Coverage.glyphs, sub.PairSet):
                    for pair in pairs.PairValueRecord:
                        add_pair(first, pair.SecondGlyph, getattr(pair.Value1, 'XAdvance', 0) if pair.Value1 else 0)
            elif sub.Format == 2:
                second_classes = {}
                for name in by_name:
                    second_classes.setdefault(sub.ClassDef2.classDefs.get(name, 0), []).append(name)
                for first in sub.Coverage.glyphs:
                    row = sub.Class1Record[sub.ClassDef1.classDefs.get(first, 0)]
                    for klass, seconds in second_classes.items():
                        value = row.Class2Record[klass].Value1
                        adjustment = getattr(value, 'XAdvance', 0) if value else 0
                        if adjustment:
                            for second in seconds: add_pair(first, second, adjustment)
            else: raise ValueError('Unsupported kerning format')
# Keep missing Latin accents and punctuation identical to the native font stack.
# Font binaries remain unmodified; the vector renderer uses Patrick Hand only
# for characters that the selected family does not contain.
fallback_path = root / 'assets/patrick-hand-outlines.json'
if Path(args.output).name != fallback_path.name and fallback_path.exists():
    fallback = json.loads(fallback_path.read_text())
    scale = font['head'].unitsPerEm / fallback['units']
    for code, glyph in fallback['chars'].items():
        if int(code) in chars: continue
        chars[int(code)] = {'a': glyph['a'] * scale,
            'c': [[c[0], *[n * scale for n in c[1:]]] for c in glyph['c']],
            'b': [n * scale for n in glyph['b']] if glyph['b'] else None}
payload = json.dumps({'units': font['head'].unitsPerEm, 'chars': chars, 'kern': kern}, separators=(',', ':'))
output = root / args.output
if output.suffix == '.gz': output.write_bytes(gzip.compress(payload.encode(), mtime=0))
else: output.write_text(payload)
