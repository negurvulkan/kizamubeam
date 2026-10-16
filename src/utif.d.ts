// Typen für utif (TIFF lesen), nur der hier benutzte Teil
declare module 'utif' {
  export interface IFD {
    [tag: string]: unknown;
    width: number;
    height: number;
  }
  export function decode(buffer: ArrayBuffer): IFD[];
  export function decodeImage(buffer: ArrayBuffer, ifd: IFD): void;
  export function toRGBA8(ifd: IFD): Uint8Array;
  const UTIF: { decode: typeof decode; decodeImage: typeof decodeImage; toRGBA8: typeof toRGBA8 };
  export default UTIF;
}
