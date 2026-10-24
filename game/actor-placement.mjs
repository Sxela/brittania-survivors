// Classic atlases retain signed native frame bounds. The bottom of an atlas
// includes shadow pixels and is not the actor's ground origin.
export function actorAnchorY(def) {
  return def.nativeBounds ? -def.nativeBounds[1] : def.anchorY;
}
