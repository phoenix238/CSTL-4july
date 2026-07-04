/** The 19-circle flower-of-life mark from the design, cream on the clay disc. */
export function FlowerOfLife({ size = 24 }: { size?: number }) {
  const centers: Array<[number, number]> = [
    [20, 20],
    [26, 20],
    [14, 20],
    [23, 14.804],
    [17, 14.804],
    [23, 25.196],
    [17, 25.196],
    [20, 9.608],
    [14, 9.608],
    [26, 9.608],
    [20, 30.392],
    [14, 30.392],
    [26, 30.392],
    [11, 14.804],
    [29, 14.804],
    [11, 25.196],
    [29, 25.196],
    [8, 20],
    [32, 20],
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="oklch(0.98 0.008 85)"
      strokeWidth="0.9"
      style={{ opacity: 0.95 }}
      aria-hidden
    >
      {centers.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="6" />
      ))}
    </svg>
  );
}
