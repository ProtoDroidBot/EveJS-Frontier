/** Cartesian coordinates used by the space simulation and scene projections. */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** Standard simulation command outcome; individual commands specialize data. */
export interface OperationResult<T = Record<string, any>> {
  success: boolean;
  errorMsg?: string;
  stopReason?: string;
  data?: T;
}
