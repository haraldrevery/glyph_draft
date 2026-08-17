import type { GeometryService } from "./GeometryService";
import { PaperGeometryService } from "./PaperGeometryService";

/**
 * The single place the app obtains its geometry engine. Everything else depends
 * only on the GeometryService interface, so replacing the implementation is a
 * one-line change here, with no ripple into the stores or UI.
 *
 * The live engine is PaperGeometryService (curve-preserving booleans). The pure
 * PolygonGeometryService (which flattens curves) is still available for the
 * DOM-free unit tests, which inject it directly rather than going through here.
 */
let instance: GeometryService | null = null;

export function getGeometryService(): GeometryService {
  if (!instance) instance = new PaperGeometryService();
  return instance;
}
