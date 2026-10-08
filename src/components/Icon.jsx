// Line icons drawn on a 24px grid with a 1.5px stroke. One <path d> string per icon;
// several sub-paths are joined with "M". No icon fonts, no emoji.
const P = {
  brief: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6',
  library: 'M3 5h8v14H3zM13 5h8v6h-8zM13 13h8v6h-8z',
  grid: 'M4 4h4.5v4.5H4zM9.75 4h4.5v4.5h-4.5zM15.5 4H20v4.5h-4.5zM4 9.75h4.5v4.5H4zM9.75 9.75h4.5v4.5h-4.5zM15.5 9.75H20v4.5h-4.5zM4 15.5h4.5V20H4zM9.75 15.5h4.5V20h-4.5zM15.5 15.5H20V20h-4.5z',
  create: 'M4 20l4-1 11-11-3-3L5 16zM14 7l3 3M4 20h16',
  write: 'M4 6h16M4 10h16M4 14h10M4 18h7',
  review: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  megaphone: 'M4 10v4h3l7 4V6L7 10zM17 9a4 4 0 0 1 0 6M7 14l1 5h2.5',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  up: 'M5 15l7-7 7 7',
  arrowRight: 'M4 12h15M13 6l6 6-6 6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12M7 11l5 5 5-5M4 16v4h16v-4',
  drive: 'M8.5 4h7l5.5 9.5-3.5 6h-11L3 13.5zM8.5 4l5.5 9.5M15.5 4L10 13.5M3 13.5h11M21 13.5l-3.5 6',
  sparkle: 'M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
  filter: 'M4 5h16l-6 7.5V19l-4 1.5v-8z',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5z',
  eyeOff: 'M4 4l16 16M10 5.7A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.3 7.2C3.9 8.9 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.6 9.6 0 0 0 4.2-1M10 10a2.75 2.75 0 0 0 4 4',
  refresh: 'M19.5 8A8 8 0 0 0 4.6 9.5M4.5 16a8 8 0 0 0 14.9-1.5M19.5 3.5V8H15M4.5 20.5V16H9',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  warning: 'M12 3.5L2.5 20h19zM12 10v4.5M12 17.2v.3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2.5-2.5L20 17M15.5 8.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  swap: 'M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  play: 'M7 4.5v15l12-7.5z',
  cloud: 'M7 18h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 9.6 4.2 4.2 0 0 0 7 18z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.5c1-4 4.3-6 8-6s7 2 8 6',
  logout: 'M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2',
  send: 'M3.5 11.5L20.5 4l-7.5 17-2.5-7z M10.5 14L20.5 4',
  undo: 'M9 5L4 10l5 5M4 10h10a6 6 0 0 1 0 12h-3',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20M10.5 8v5M8 10.5h5',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20M8 10.5h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  collapse: 'M15 5l-7 7 7 7M20 4v16',
  expand: 'M9 5l7 7-7 7M4 4v16',
  carousel: 'M7 5h10v14H7zM4 7v10M20 7v10',
  reel: 'M4 4h16v16H4zM4 9h16M9 4l2 5M15 4l2 5M10.5 12.5v4.5l4-2.25z',
  story: 'M7 2.5h10v19H7zM10 5h4',
  single: 'M5 4h14v16H5z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z',
  palette: 'M12 3a9 9 0 0 0 0 18c1.2 0 1.7-1 1.2-2-.6-1.2.2-2.5 1.5-2.5H17a4 4 0 0 0 4-4C21 7 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  book: 'M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5zM19 4h-6M19 4v14h-6',
  flask: 'M9 3h6M10 3v6l-5 10h14L14 9V3M7.5 14h9',
  key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10.8 12.2L20 3M16 7l3 3M14 9l2 2',
  database: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  bolt: 'M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z',
  heart: 'M12 20s-7.5-4.5-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.5-7.5 10-7.5 10z',
  bookmark: 'M6 3.5h12v17l-6-4.5-6 4.5z',
  share: 'M20.5 3.5L9 15M20.5 3.5l-7 17-4.5-5.5-5.5-4.5z',
}

export default function Icon({ name, size = 16, className = '', title, strokeWidth = 1.5, style }) {
  const d = P[name]
  if (!d) return null
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={style}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  )
}
