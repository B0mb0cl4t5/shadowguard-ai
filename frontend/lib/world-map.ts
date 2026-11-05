import { WORLD_DOTS } from "./world-dots";

/** Shared geometry for the dotted world map, so the traffic map and the sign-in page draw the same world. */
export const MAP_W = 1000;
export const MAP_H = 392;
const SCALE = MAP_W / 350;

export type Point = readonly [number, number];

export const project = (lon: number, lat: number): Point => [(lon + 170) * SCALE, (80 - lat) * SCALE];

/** Each set of dots is one path, so the backdrop stays a few elements however much land there is. */
export function dotPath(keep: (lon: number, lat: number) => boolean = () => true): string {
  return WORLD_DOTS.flatMap((row, r) =>
    [...row].flatMap((cell, c) => {
      const lon = -170 + c * 2;
      const lat = 80 - r * 2;
      return cell === "#" && keep(lon, lat) ? [`M${(c * 2 * SCALE).toFixed(1)} ${(r * 2 * SCALE).toFixed(1)}h0`] : [];
    }),
  ).join("");
}

/** Peninsular Malaysia and Malaysian Borneo, where the campus is. */
export const isMalaysia = (lon: number, lat: number) => lon >= 99 && lon <= 120 && lat > 2 && lat <= 8;
