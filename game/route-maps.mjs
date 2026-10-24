// Only the six selected native areas are decoded into images for a run.
export function routeMapManifest(source, route, duration = 600) {
  if (!Array.isArray(route) || !route.length) throw Error('A run needs an area route');
  const regions = route.map((area, index) => {
    const region = source.regions.find(r => (r.areaId || r.id) === area.id && (!r.routeFacet || r.routeFacet === area.facet));
    if (!region) throw Error(`Native terrain unavailable for ${area.name}`);
    return {...region, id: index, areaId: area.id, name: area.name, runFacet: area.facet};
  });
  const keys = new Set(regions.flatMap(r => [r.ground, r.radar, ...r.statics.map(s => s.image)]).filter(Boolean));
  const images = {};
  for (const key of keys) {
    if (!source.images[key]) throw Error(`Missing area image ${key}`);
    images[key] = source.images[key];
  }
  return {...source, regions, images, stageSeconds: duration / route.length};
}

export function locationManifestForArea(source,area){
  const region=source.regions.find(r=>r.areaId===area.id);
  if(!region)throw Error(`Original location unavailable for ${area.name}`);
  const keys=new Set([region.radar,...[...region.grounds,...(region.backdropGrounds||[])].map(g=>g.image),...[...region.statics,...(region.backdropStatics||[])].map(s=>s.image),...(source.moongate?.frames||[])].filter(Boolean));
  const images={};
  for(const key of keys){if(!source.images[key])throw Error(`Missing location image ${key}`);images[key]=source.images[key];}
  return {...source,images,regions:[{...region,id:0,runFacet:area.facet}]};
}
