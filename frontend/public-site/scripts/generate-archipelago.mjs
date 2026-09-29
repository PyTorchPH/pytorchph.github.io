// Generates assets/images/ph-network.svg: the Philippine archipelago drawn as a connected network
// of nodes, used as subtle hero artwork. Deterministic; rerun after changing the constants below.
// Outline: Natural Earth 1:50m (public domain), scripts/data/philippines.geo.json.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SPACING_DEG = 0.34; // grid spacing between nodes, in degrees of latitude
const LINK_DISTANCE = 1.25; // neighbors within this many spacings are linked
const BRIDGE_DISTANCE = 3.4; // islands closer than this many spacings get one bridging link
const WIDTH = 600;
const PADDING = 24;
const ORANGE = "#ee4c2c";
const HUBS = [
  { name: "Manila", lon: 120.98, lat: 14.6 },
  { name: "Cebu", lon: 123.89, lat: 10.32 },
  { name: "Davao", lon: 125.61, lat: 7.07 },
];

const root = resolve(import.meta.dirname, "..");
const { geometry } = JSON.parse(readFileSync(resolve(import.meta.dirname, "data/philippines.geo.json"), "utf8"));
const polygons = geometry.coordinates;

const all = polygons.flat(2);
const minLon = Math.min(...all.map(([lon]) => lon)), maxLon = Math.max(...all.map(([lon]) => lon));
const minLat = Math.min(...all.map(([, lat]) => lat)), maxLat = Math.max(...all.map(([, lat]) => lat));
const lonScale = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180); // equirectangular, corrected at mid-latitude
const scale = (WIDTH - 2 * PADDING) / ((maxLon - minLon) * lonScale);
const height = Math.round((maxLat - minLat) * scale + 2 * PADDING);
const project = ([lon, lat]) => [PADDING + (lon - minLon) * lonScale * scale, PADDING + (maxLat - lat) * scale];

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (point, [outer, ...holes]) => inRing(point, outer) && !holes.some(hole => inRing(point, hole));
const centroid = ring => [ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length, ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length];

// Hexagonal grid of nodes inside each island; islands too small to catch a grid point get one node.
const nodes = [];
polygons.forEach((polygon, island) => {
  const before = nodes.length;
  let row = 0;
  for (let lat = minLat; lat <= maxLat; lat += SPACING_DEG * 0.866, row++) {
    for (let lon = minLon + (row % 2 ? SPACING_DEG / (2 * lonScale) : 0); lon <= maxLon; lon += SPACING_DEG / lonScale) {
      if (inPolygon([lon, lat], polygon)) nodes.push({ island, point: project([lon, lat]) });
    }
  }
  if (nodes.length === before) nodes.push({ island, point: project(centroid(polygon[0])) });
});

const unit = SPACING_DEG * scale;
const distance = (a, b) => Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1]);
const links = [];
const bridges = new Map();
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const length = distance(nodes[i], nodes[j]);
    if (nodes[i].island === nodes[j].island) {
      if (length <= LINK_DISTANCE * unit) links.push([i, j]);
    } else if (length <= BRIDGE_DISTANCE * unit) {
      const key = [nodes[i].island, nodes[j].island].sort((a, b) => a - b).join("-");
      if (!bridges.has(key) || bridges.get(key).length > length) bridges.set(key, { pair: [i, j], length });
    }
  }
}

const hubs = HUBS.map(hub => ({ ...hub, point: project([hub.lon, hub.lat]) }));
const arcs = [[0, 1], [1, 2], [0, 2]].map(([from, to]) => {
  const [x1, y1] = hubs[from].point, [x2, y2] = hubs[to].point;
  const bend = Math.hypot(x2 - x1, y2 - y1) * 0.22; // bow each long-distance link to the east
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${((x1 + x2) / 2 + bend).toFixed(1)} ${((y1 + y2) / 2).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
});

const line = ([i, j]) => `M${nodes[i].point.map(v => v.toFixed(1)).join(" ")}L${nodes[j].point.map(v => v.toFixed(1)).join(" ")}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" fill="none" stroke-linecap="round">
<path stroke="${ORANGE}" stroke-width="0.8" stroke-opacity="0.45" d="${links.map(line).join("")}"/>
<path stroke="${ORANGE}" stroke-width="0.8" stroke-opacity="0.3" stroke-dasharray="2 4" d="${[...bridges.values()].map(({ pair }) => line(pair)).join("")}"/>
<path stroke="${ORANGE}" stroke-width="1.2" stroke-opacity="0.55" d="${arcs.join("")}"/>
<g fill="${ORANGE}" fill-opacity="0.85">${nodes.map(({ point: [x, y] }) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.9"/>`).join("")}</g>
<g fill="${ORANGE}">${hubs.map(({ point: [x, y] }) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill-opacity="0.18"/>`).join("")}</g>
</svg>
`;
writeFileSync(resolve(root, "assets/images/ph-network.svg"), svg);
console.log(JSON.stringify({ event: "site.archipelago.generated", outcome: "success", nodes: nodes.length, links: links.length, bridges: bridges.size, size: `${WIDTH}x${height}`, bytes: svg.length }));
