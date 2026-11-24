import React from 'react';

/** One consistent stroke icon set (24px grid, 1.75 stroke) for the whole app. */
const PATHS = {
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M19 11a7 7 0 0 1-14 0 M12 18v3 M8.5 21h7',
    camera: 'M4 8a2 2 0 0 1 2-2h1.5l1.4-2h6.2l1.4 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    chat: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
    pen: 'M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4',
    wave: 'M3 12h2 M7 8v8 M11 5v14 M15 9v6 M19 11v2',
    chip: 'M8 3v2 M16 3v2 M8 19v2 M16 19v2 M3 8h2 M3 16h2 M19 8h2 M19 16h2 M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M10 10h4v4h-4Z',
    settings: 'M10.3 4.3a1.7 1.7 0 0 1 3.4 0 1.7 1.7 0 0 0 2.6 1.1 1.7 1.7 0 0 1 2.4 2.4 1.7 1.7 0 0 0 1.1 2.6 1.7 1.7 0 0 1 0 3.4 1.7 1.7 0 0 0-1.1 2.6 1.7 1.7 0 0 1-2.4 2.4 1.7 1.7 0 0 0-2.6 1.1 1.7 1.7 0 0 1-3.4 0 1.7 1.7 0 0 0-2.6-1.1 1.7 1.7 0 0 1-2.4-2.4 1.7 1.7 0 0 0-1.1-2.6 1.7 1.7 0 0 1 0-3.4 1.7 1.7 0 0 0 1.1-2.6 1.7 1.7 0 0 1 2.4-2.4 1.7 1.7 0 0 0 2.6-1.1Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0',
    logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 16l-4-4 4-4 M6 12h11',
    sparkles: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15Z M5 15l.5 1.3 1.3.5-1.3.5L5 18.5l-.5-1.2-1.3-.5 1.3-.5L5 15Z',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9s1.3-6.3 3.8-9Z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    chevronDown: 'M6 9l6 6 6-6',
    chevronRight: 'M9 6l6 6-6 6',
    arrowRight: 'M5 12h14 M13 6l6 6-6 6',
    x: 'M6 6l12 12 M18 6 6 18',
    stop: 'M7 7h10v10H7Z',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6 M12 17h.01',
    image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z M4 16l4.5-4.5a1.5 1.5 0 0 1 2 0L16 17 M14 14l1.5-1.5a1.5 1.5 0 0 1 2 0L20 15 M15.5 8.5h.01',
    book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z M5 17a3 3 0 0 1 3-3h10',
    flame: 'M12 21c3.9 0 6.5-2.6 6.5-6.3 0-3.2-2-5.3-3.6-7.3-.4 1.8-1.4 2.8-2.4 3.2.4-2.9-.7-5.7-3-7.6.1 3-1.6 5.1-3.2 7C4.9 12 5.5 13.6 5.5 14.7 5.5 18.4 8.1 21 12 21Z',
    tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3 M6 11h12v10H6Z',
    bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
    speaker: 'M4 9h3l5-4v14l-5-4H4Z M16 9a3.5 3.5 0 0 1 0 6 M18.5 6.5a7 7 0 0 1 0 11',
    cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z',
    download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
    play: 'M8 5v14l11-7L8 5Z',
    ear: 'M6.5 9a5.5 5.5 0 0 1 11 0c0 3.2-3.2 4.3-3.2 7.2a3.3 3.3 0 0 1-6.2 1.6 M9.5 9a2.5 2.5 0 0 1 5 0c0 1.4-1.2 2-1.8 2.9',
    expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    swap: 'M7 7h11l-3-3 M17 17H6l3 3',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends React.SVGProps<SVGSVGElement> {
    name: IconName;
    size?: number;
    strokeWidth?: number;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, strokeWidth = 1.75, className, ...rest }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
        {...rest}
    >
        <path d={PATHS[name]} />
    </svg>
);
