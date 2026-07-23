'use client';

import { useRef, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import './GooeyNav.css';

interface NavItem {
    label: string;
    href: string;
    icon?: React.ReactNode;
}

interface GooeyNavProps {
    items: NavItem[];
    particleCount?: number;
    particleDistances?: [number, number];
    particleR?: number;
    initialActiveIndex?: number;
    animationTime?: number;
    timeVariance?: number;
    colors?: number[];
    className?: string;
}

const noise = (n = 1) => n / 2 - Math.random() * n;

const getXY = (distance: number, pointIndex: number, totalPoints: number) => {
    const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
};

const makeParticles = (
    element: HTMLElement,
    options: {
        particleCount: number;
        particleDistances: [number, number];
        particleR: number;
        animationTime: number;
        timeVariance: number;
        colors: number[];
    }
) => {
    const { particleCount, particleDistances: d, particleR: r, animationTime, timeVariance, colors } = options;
    const bubbleTime = animationTime * 2 + timeVariance;
    element.style.setProperty('--time', `${bubbleTime}ms`);

    const createParticle = (i: number) => {
        let rotate = noise(r / 10);
        return {
            start: getXY(d[0], particleCount - i, particleCount),
            end: getXY(d[1] + noise(7), particleCount - i, particleCount),
            time: animationTime * 2 + noise(timeVariance * 2),
            scale: 1 + noise(0.2),
            color: colors[Math.floor(Math.random() * colors.length)],
            rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
        };
    };

    for (let i = 0; i < particleCount; i++) {
        const p = createParticle(i);
        element.classList.remove('active');

        setTimeout(() => {
            const particle = document.createElement('span');
            const point = document.createElement('span');
            particle.classList.add('particle');
            particle.style.setProperty('--start-x', `${p.start[0]}px`);
            particle.style.setProperty('--start-y', `${p.start[1]}px`);
            particle.style.setProperty('--end-x', `${p.end[0]}px`);
            particle.style.setProperty('--end-y', `${p.end[1]}px`);
            particle.style.setProperty('--time', `${p.time}ms`);
            particle.style.setProperty('--scale', `${p.scale}`);
            particle.style.setProperty('--color', `var(--color-${p.color}, white)`);
            particle.style.setProperty('--rotate', `${p.rotate}deg`);

            point.classList.add('point');
            particle.appendChild(point);
            element.appendChild(particle);
            requestAnimationFrame(() => {
                element.classList.add('active');
            });
            setTimeout(() => {
                try {
                    element.removeChild(particle);
                } catch {
                    // Do nothing
                }
            }, p.time);
        }, 30);
    }
};

export default function GooeyNav({
    items,
    particleCount = 15,
    particleDistances = [90, 10],
    particleR = 100,
    initialActiveIndex = 0,
    animationTime = 600,
    timeVariance = 300,
    colors = [1, 2, 3, 1, 2, 3, 1, 4],
    className = '',
}: GooeyNavProps) {
    const router = useRouter();
    const pathname = usePathname();
    const containerRef = useRef<HTMLDivElement>(null);
    const navRef = useRef<HTMLUListElement>(null);
    const filterRef = useRef<HTMLSpanElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const [activeIndex, setActiveIndex] = useState(initialActiveIndex);

    // Find initial active index from current pathname
    useEffect(() => {
        const idx = items.findIndex(item => pathname?.startsWith(item.href));
        if (idx !== -1 && idx !== activeIndex) {
            setActiveIndex(idx);
            // Update effect position after render
            setTimeout(() => {
                const liEl = navRef.current?.querySelectorAll('li')[idx];
                if (liEl) updateEffectPosition(liEl);
            }, 0);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    const updateEffectPosition = (element: Element) => {
        if (!containerRef.current || !filterRef.current || !textRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const pos = element.getBoundingClientRect();

        const styles = {
            left: `${pos.x - containerRect.x}px`,
            top: `${pos.y - containerRect.y}px`,
            width: `${pos.width}px`,
            height: `${pos.height}px`,
        };
        Object.assign(filterRef.current.style, styles);
        Object.assign(textRef.current.style, styles);
        textRef.current.innerText = (element.querySelector('a') || element).textContent || '';
    };

    const handleClick = (e: React.MouseEvent, index: number) => {
        e.preventDefault();
        const liEl = e.currentTarget as HTMLElement;
        if (activeIndex === index) return;

        setActiveIndex(index);
        updateEffectPosition(liEl);

        if (filterRef.current) {
            filterRef.current.querySelectorAll('.particle').forEach(p => {
                if (filterRef.current) filterRef.current.removeChild(p);
            });
        }

        if (textRef.current) {
            textRef.current.classList.remove('active');
            void textRef.current.offsetWidth;
            textRef.current.classList.add('active');
        }

        if (filterRef.current) {
            makeParticles(filterRef.current, {
                particleCount,
                particleDistances,
                particleR,
                animationTime,
                timeVariance,
                colors,
            });
        }

        // Navigate
        router.push(items[index].href);
    };

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick(e as unknown as React.MouseEvent, index);
        }
    };

    useEffect(() => {
        if (!navRef.current || !containerRef.current) return;
        const activeLi = navRef.current.querySelectorAll('li')[activeIndex];
        if (activeLi) {
            updateEffectPosition(activeLi);
            textRef.current?.classList.add('active');
        }

        const resizeObserver = new ResizeObserver(() => {
            const currentActiveLi = navRef.current?.querySelectorAll('li')[activeIndex];
            if (currentActiveLi) {
                updateEffectPosition(currentActiveLi);
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [activeIndex]);

    return (
        <div className={`gooey-nav-container ${className}`} ref={containerRef}>
            <nav>
                <ul ref={navRef}>
                    {items.map((item, index) => (
                        <li
                            key={index}
                            className={activeIndex === index ? 'active' : ''}
                        >
                            <a
                                href={item.href}
                                onClick={(e) => handleClick(e, index)}
                                onKeyDown={(e) => handleKeyDown(e, index)}
                                className="flex items-center gap-2"
                            >
                                {item.icon && <span className="shrink-0">{item.icon}</span>}
                                <span>{item.label}</span>
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>
            <span className="effect filter" ref={filterRef} />
            <span className="effect text" ref={textRef} />
        </div>
    );
}
