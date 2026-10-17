from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import posixpath, json, re, hashlib

base=Path('D:/Documents/UEMA/SRGOP2/.presentation-notes-build')
source=Path('D:/Documents/UEMA/ADS UEMA/Desenv. Web/Vida_Util_Mais_Apresentacao.pptx')
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
rel_ns='http://schemas.openxmlformats.org/package/2006/relationships'
office='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
def xml(b): return E.fromstring(b)
def dump(r): return E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
def body(r): return r.xpath('//p:sp[p:nvSpPr/p:nvPr/p:ph[@type="body"]]/p:txBody',namespaces=ns)[0]
def resolve(part,target): return posixpath.normpath(posixpath.join(posixpath.dirname(part),target)) if not target.startswith('/') else target[1:]
def notes_part(data, slide):
    rel=xml(data[f'ppt/slides/_rels/slide{slide}.xml.rels'])
    links=[r for r in rel if r.get('Type')==office+'notesSlide']
    return resolve(f'ppt/slides/slide{slide}.xml',links[0].get('Target')) if links else None

with ZipFile(source) as z: original={n:z.read(n) for n in z.namelist()}
with ZipFile(base/'notes-export.pptx') as z: generated={n:z.read(n) for n in z.namelist()}
data=original.copy()
notes=json.loads((base/'notes-complete.json').read_text(encoding='utf-8'))
for i in range(1,13):
    newbody=deepcopy(body(xml(generated[notes_part(generated,i)])))
    for r in newbody.xpath('.//a:r',namespaces=ns):
        props=E.Element('{'+ns['a']+'}rPr',lang='pt-BR',sz='1200')
        r.insert(0,props)
    dest=notes_part(data,i)
    if dest:
        root=xml(data[dest])
    else:
        dest='ppt/notesSlides/notesSlide12.xml'
        assert dest not in data
        root=xml(original['ppt/notesSlides/notesSlide1.xml'])
        for t in root.xpath('//a:fld[@type="slidenum"]/a:t',namespaces=ns): t.text=str(i)
        ext=root.find('p:cSld/p:extLst',ns)
        if ext is not None: ext.getparent().remove(ext)
        rel=xml(original['ppt/notesSlides/_rels/notesSlide1.xml.rels'])
        for r in rel:
            if r.get('Type')==office+'slide': r.set('Target',f'../slides/slide{i}.xml')
        data['ppt/notesSlides/_rels/notesSlide12.xml.rels']=dump(rel)
        slide_rel_name=f'ppt/slides/_rels/slide{i}.xml.rels'
        slide_rel=xml(data[slide_rel_name]);ids={r.get('Id') for r in slide_rel}
        k=1
        while f'rId{k}' in ids: k+=1
        E.SubElement(slide_rel,'{'+rel_ns+'}Relationship',Id=f'rId{k}',Type=office+'notesSlide',Target='../notesSlides/notesSlide12.xml')
        data[slide_rel_name]=dump(slide_rel)
        ct=xml(data['[Content_Types].xml'])
        E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/'+dest,ContentType='application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml')
        data['[Content_Types].xml']=dump(ct)
    oldbody=body(root);oldbody.getparent().replace(oldbody,newbody)
    data[dest]=dump(root)

candidate=base/'candidate.pptx'
with ZipFile(candidate,'w',ZIP_DEFLATED) as z:
    for name,content in data.items(): z.writestr(name,content)
changed=[n for n in original if original[n]!=data[n]]
for name in changed:
    assert name.startswith('ppt/notesSlides/') or name in ['[Content_Types].xml','ppt/slides/_rels/slide5.xml.rels'],name
for i,n in enumerate(notes,1):
    texts=[''.join(p.xpath('.//a:t/text()',namespaces=ns)) for p in body(xml(data[notes_part(data,i)])).findall('a:p',ns)]
    assert '\n'.join(texts)==n['note'],i
visual_parts=[n for n in original if n.startswith(('ppt/slides/slide','ppt/media/','ppt/slideMasters/','ppt/slideLayouts/','ppt/theme/'))]
assert all(original[n]==data[n] for n in visual_parts)
report={'slides':12,'notes':12,'speech_words':sum(len(n['speech'].split()) for n in notes),'suggested_seconds':sum(n['duration'] for n in notes),'unchanged_visual_parts':len(visual_parts),'changed_parts':changed,'added_parts':list(set(data)-set(original)),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
(base/'preservation-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
