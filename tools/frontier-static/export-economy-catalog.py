"""Export the pinned 3640684 chemistry catalog; no client/native code is executed.
Layouts are established from the shipped loader attribute getters. Hashes and
schema fingerprints reject other builds before interpreting offsets.
"""
from pathlib import Path
import argparse,hashlib,json,struct,importlib.util
spec=importlib.util.spec_from_file_location('voxel',Path(__file__).with_name('export-voxel-catalog.py'))
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
NAMES=['recipe','recipeinput','recipeinputtrait','recipeoutput','recipeoutputtransform','recipeoutputtransformsource','recipeoutputtransformbreakpoint','neotypeproperty']
MD5=['a56b3c69d3e46155df7eec19587578ad','eff67ebb52cb745a65f01cbb0a545dc8','2f974937b0276946d22f1233229c64ca','754cdf193df6a7a21722483f6314a742','14dcf1b35ae7d517540cc8068ae0c842','9e730105523a5aab742676c61635ba84','4ea58ad3a33e87aa4de3ba9ffb7b47f9','11cc427b837c2a0ce863e033bee5e6c7']
def export(root):
 index={line.split(',')[0]:line.split(',')[1] for line in (root/'stillness/resfileindex.txt').read_text().splitlines()}
 sources={};data={}
 for name,md5 in zip(NAMES,MD5):
  resource=index['res:/staticdata/'+name+'.fsdbinary'];raw=(root/'ResFiles'/resource).read_bytes()
  if hashlib.md5(raw).hexdigest()!=md5:raise ValueError('Unsupported resource '+name)
  sources[name]={'resource':resource,'sha256':hashlib.sha256(raw).hexdigest(),'schema':raw[:16].hex()};data[name]=raw
 def rows(name,stride):
  body,roots=v.root_rows(data[name],16);out={}
  for key,off in roots.items():
   ptr=v.scalar(body,off+8,'<Q');count=v.scalar(body,ptr-8,'<Q')
   out[key]=[body[ptr+i*stride:ptr+(i+1)*stride] for i in range(count)]
  return out
 inputs=rows('recipeinput',16);outputs=rows('recipeoutput',12);transforms=rows('recipeoutputtransform',32);sources_rows=rows('recipeoutputtransformsource',24)
 ranges={}
 for typeid,values in rows('neotypeproperty',16).items():
  ranges[typeid]={}
  for raw in values:
   mx,mn,pid,mask=struct.unpack('<ffII',raw);ranges[typeid][pid]={'min':mn if mask&2 else None,'max':mx if mask&1 else None}
 body,roots=v.root_rows(data['recipe'],24);recipes=[]
 for rid,off in roots.items():
  rec={'recipe_id':rid,'name':v.read_string(body,off+8),'duration':v.scalar(body,off+16),'inputs':[],'outputs':[],'transforms':[],'sources':[]}
  for raw in inputs[rid]:
   ix,qty,tid,mask=struct.unpack('<IfII',raw);rec['inputs'].append({'index':ix,'typeID':tid if mask&1 else None,'quantity':qty})
  for raw in outputs[rid]:
   ix,qty,tid=struct.unpack('<IfI',raw);rec['outputs'].append({'index':ix,'typeID':tid,'quantity':qty})
  for raw in transforms[rid]:
   ptr,fixed,linear,ix,pid,mask=struct.unpack_from('<QffIII',raw)
   transform_body=data['recipeoutputtransform'][32:];length=v.scalar(transform_body,ptr-8,'<Q')
   rec['transforms'].append({'outputIndex':ix,'propertyID':pid,'op':transform_body[ptr:ptr+length].decode(),'fixedValue':fixed if mask&1 else None,'linearConstant':linear if mask&2 else None})
  for raw in sources_rows[rid]:
   coeff,ix,oi,pid,spid,mask=struct.unpack('<fIIIII',raw);rec['sources'].append({'outputIndex':oi,'propertyID':pid,'inputIndex':ix,'sourcePropertyID':spid,'coefficient':coeff if mask&1 else None})
  if any(rows(name,8)[rid] for name in ['recipeinputtrait','recipeoutputtransformbreakpoint']):raise ValueError('Nonempty unsupported satellite records')
  recipes.append(rec)
 type_ids={x['typeID'] for r in recipes for x in r['inputs']+r['outputs']};type_ids.update([72244,77518])
 src=v.read_sources(root);types,trows=v.root_rows(src['types'],144);groups,grows=v.root_rows(src['groups'],32)
 import io
 loc=v.DataOnlyUnpickler(io.BytesIO(src['localization']),encoding='bytes').load()[1]
 metadata=[]
 for tid in sorted(type_ids):
  if tid not in trows:continue
  off=trows[tid];gid=v.scalar(types,off+88)
  metadata.append({'typeID':tid,'name':loc[v.scalar(types,off+124)][0],'groupID':gid,'categoryID':v.scalar(groups,grows[gid]+4),'mass':v.scalar(types,off+24,'<d'),'volume':v.scalar(types,off+64,'<d'),'radius':v.scalar(types,off+48,'<d')})
 return {'build':3640684,'sources':sources,'recipes':recipes,'propertyRanges':{str(t):ranges.get(t,{}) for t in type_ids},'types':metadata}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--client-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();result=export(a.client_root);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n');print('Exported',len(result['recipes']),'recipes')
