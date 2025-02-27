import * as React from 'react';
import {detectOverflow, offset} from '@floating-ui/react-dom';
import type {
  SideObject,
  DetectOverflowOptions,
  Middleware,
  FloatingContext,
  ElementProps,
  MiddlewareArguments,
} from './types';
import {flushSync} from 'react-dom';
import {getUserAgent} from './utils/getPlatform';
import {useEvent} from './utils/useEvent';

function getArgsWithCustomFloatingHeight(
  args: MiddlewareArguments,
  height: number
) {
  return {
    ...args,
    rects: {
      ...args.rects,
      floating: {
        ...args.rects.floating,
        height,
      },
    },
  };
}

export const inner = (
  options: {
    listRef: React.MutableRefObject<Array<HTMLElement | null>>;
    index: number;
    onFallbackChange?: null | ((fallback: boolean) => void);
    offset?: number;
    overflowRef?: React.MutableRefObject<SideObject | null>;
    scrollRef?: React.MutableRefObject<HTMLElement | null>;
    minItemsVisible?: number;
    referenceOverflowThreshold?: number;
  } & Partial<DetectOverflowOptions>
): Middleware => ({
  name: 'inner',
  options,
  async fn(middlewareArguments) {
    const {
      listRef,
      overflowRef,
      onFallbackChange,
      offset: innerOffset = 0,
      index = 0,
      minItemsVisible = 4,
      referenceOverflowThreshold = 0,
      scrollRef,
      ...detectOverflowOptions
    } = options;

    const {
      rects,
      elements: {floating},
    } = middlewareArguments;

    const item = listRef.current[index];

    if (__DEV__) {
      if (!middlewareArguments.placement.startsWith('bottom')) {
        console.warn(
          [
            'Floating UI: `placement` side must be "bottom" when using the',
            '`inner` middleware.',
          ].join(' ')
        );
      }
    }

    if (!item) {
      return {};
    }

    const nextArgs = {
      ...middlewareArguments,
      ...(await offset(
        -item.offsetTop -
          rects.reference.height / 2 -
          item.offsetHeight / 2 -
          innerOffset
      ).fn(middlewareArguments)),
    };

    const el = scrollRef?.current ?? floating;

    const overflow = await detectOverflow(
      getArgsWithCustomFloatingHeight(nextArgs, el.scrollHeight),
      detectOverflowOptions
    );
    const refOverflow = await detectOverflow(nextArgs, {
      ...detectOverflowOptions,
      elementContext: 'reference',
    });

    const diffY = Math.max(0, overflow.top);
    const nextY = nextArgs.y + diffY;

    const maxHeight = Math.max(
      0,
      el.scrollHeight - diffY - Math.max(0, overflow.bottom)
    );

    el.style.maxHeight = `${maxHeight}px`;
    el.scrollTop = diffY;

    // There is not enough space, fallback to standard anchored positioning
    if (onFallbackChange) {
      if (
        el.offsetHeight <
          item.offsetHeight *
            Math.min(minItemsVisible, listRef.current.length - 1) -
            1 ||
        refOverflow.top >= -referenceOverflowThreshold ||
        refOverflow.bottom >= -referenceOverflowThreshold
      ) {
        flushSync(() => onFallbackChange(true));
      } else {
        flushSync(() => onFallbackChange(false));
      }
    }

    if (overflowRef) {
      overflowRef.current = await detectOverflow(
        getArgsWithCustomFloatingHeight(
          {...nextArgs, y: nextY},
          el.offsetHeight
        ),
        detectOverflowOptions
      );
    }

    return {
      y: nextY,
    };
  },
});

export const useInnerOffset = (
  {open, refs}: FloatingContext,
  {
    enabled = true,
    overflowRef,
    scrollRef,
    onChange: unstable_onChange,
  }: {
    enabled?: boolean;
    overflowRef: React.MutableRefObject<SideObject | null>;
    scrollRef?: React.MutableRefObject<HTMLElement | null>;
    onChange: (offset: number | ((offset: number) => number)) => void;
  }
): ElementProps => {
  const onChange = useEvent(unstable_onChange);
  const controlledScrollingRef = React.useRef(false);
  const prevScrollTopRef = React.useRef<number | null>(null);
  const initialOverflowRef = React.useRef<SideObject | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || !el || overflowRef.current == null) {
        return;
      }

      const dY = e.deltaY;
      const isAtTop = overflowRef.current.top >= -0.5;
      const isAtBottom = overflowRef.current.bottom >= -0.5;
      const remainingScroll = el.scrollHeight - el.clientHeight;
      const sign = dY < 0 ? -1 : 1;
      const method = dY < 0 ? 'max' : 'min';

      if (el.scrollHeight <= el.clientHeight) {
        return;
      }

      if ((!isAtTop && dY > 0) || (!isAtBottom && dY < 0)) {
        e.preventDefault();
        flushSync(() => {
          onChange((d) => d + Math[method](dY, remainingScroll * sign));
        });
      } else if (/firefox/i.test(getUserAgent())) {
        // Needed to propagate scrolling during momentum scrolling phase once
        // it gets limited by the boundary. UX improvement, not critical.
        el.scrollTop += dY;
      }
    }

    const el = scrollRef?.current ?? refs.floating.current;

    if (open && el) {
      el.addEventListener('wheel', onWheel);

      // Wait for the position to be ready.
      requestAnimationFrame(() => {
        prevScrollTopRef.current = el.scrollTop;

        if (overflowRef.current != null) {
          initialOverflowRef.current = {...overflowRef.current};
        }
      });

      return () => {
        prevScrollTopRef.current = null;
        initialOverflowRef.current = null;
        el.removeEventListener('wheel', onWheel);
      };
    }
  }, [enabled, open, refs, overflowRef, scrollRef, onChange]);

  return React.useMemo(() => {
    if (!enabled) {
      return {};
    }

    return {
      floating: {
        onKeyDown() {
          controlledScrollingRef.current = true;
        },
        onWheel() {
          controlledScrollingRef.current = false;
        },
        onPointerMove() {
          controlledScrollingRef.current = false;
        },
        onScroll() {
          const el = scrollRef?.current || refs.floating.current;

          if (!overflowRef.current || !el || !controlledScrollingRef.current) {
            return;
          }

          if (prevScrollTopRef.current !== null) {
            const scrollDiff = el.scrollTop - prevScrollTopRef.current;

            if (
              (overflowRef.current.bottom < -0.5 && scrollDiff < -1) ||
              (overflowRef.current.top < -0.5 && scrollDiff > 1)
            ) {
              flushSync(() => onChange((d) => d + scrollDiff));
            }
          }

          // [Firefox] Wait for the height change to have been applied.
          requestAnimationFrame(() => {
            prevScrollTopRef.current = el.scrollTop;
          });
        },
      },
    };
  }, [enabled, overflowRef, refs, scrollRef, onChange]);
};
