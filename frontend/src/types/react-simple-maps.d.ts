declare module "react-simple-maps" {
  import { ReactNode, MouseEvent } from "react";

  export interface ComposableMapProps {
    projection?: string;
    projectionConfig?: {
      rotate?: [number, number, number];
      center?: [number, number];
      scale?: number;
    };
    width?: number;
    height?: number;
    style?: React.CSSProperties;
    className?: string;
    children?: ReactNode;
  }
  export function ComposableMap(props: ComposableMapProps): JSX.Element;

  export interface ZoomableGroupProps {
    center?: [number, number];
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    onMoveStart?: (pos: { coordinates: [number, number]; zoom: number }) => void;
    onMoveEnd?: (pos: { coordinates: [number, number]; zoom: number }) => void;
    translateExtent?: [[number, number], [number, number]];
    children?: ReactNode;
  }
  export function ZoomableGroup(props: ZoomableGroupProps): JSX.Element;

  export interface GeographiesProps {
    geography: string | object;
    children: (args: { geographies: Geography[] }) => ReactNode;
    parseGeographies?: (geographies: Geography[]) => Geography[];
  }
  export function Geographies(props: GeographiesProps): JSX.Element;

  export interface Geography {
    rsmKey: string;
    type: string;
    properties: Record<string, string | number | null>;
    geometry: object;
  }

  export interface GeographyProps {
    geography: Geography;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: {
      default?: React.CSSProperties;
      hover?: React.CSSProperties;
      pressed?: React.CSSProperties;
    };
    onClick?: (event: MouseEvent<SVGPathElement>) => void;
    onMouseEnter?: (event: MouseEvent<SVGPathElement>) => void;
    onMouseLeave?: (event: MouseEvent<SVGPathElement>) => void;
    className?: string;
  }
  export function Geography(props: GeographyProps): JSX.Element;

  export interface MarkerProps {
    coordinates: [number, number];
    children?: ReactNode;
    onClick?: (event: MouseEvent<SVGGElement>) => void;
  }
  export function Marker(props: MarkerProps): JSX.Element;
}
