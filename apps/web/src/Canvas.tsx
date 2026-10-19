import { useEffect, useRef, type CSSProperties } from "react";

interface Props {
  image: ImageData | null;
  label: string;
  className?: string;
  style?: CSSProperties;
}

/** Shows ImageData at its native size; CSS scales it with hard pixel edges. */
export function Canvas({ image, label, className = "view", style }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.putImageData(image, 0, 0);
  }, [image]);
  return <canvas ref={ref} className={className} style={style} aria-label={label || undefined} aria-hidden={label ? undefined : true} />;
}
