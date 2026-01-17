export const toMulti = (polygon) => [[[...polygon, polygon[0]]]];

// skip first cause we use it as the init val reduce
export const removeHoles = (holedPolygon) =>
  holedPolygon
    .slice(1)
    .reduce((a, p) => martinez.union(a, [[p[0]]]), [[holedPolygon[0][0]]]);

export const cloneMultiPoly = (multi) =>
  multi.map((poly) => poly.map(([x, y]) => [x, y]));

export const unionNoHoles = (first, second) =>
  removeHoles(martinez.union(first, second));
