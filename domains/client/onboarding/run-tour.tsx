"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ACTIONS, EVENTS, Joyride, STATUS, type EventData } from "react-joyride";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { memberProductTours, productTours, tourStorageKey } from "@pytorch-ph/domain-client/onboarding";

export const START_PRODUCT_TOUR_EVENT = "pytorch-ph:start-product-tour";

export function requestProductTour() {
  window.dispatchEvent(new CustomEvent(START_PRODUCT_TOUR_EVENT));
}

// Space kept above a highlighted element, so it never sits under the sticky header.
const SCROLL_GAP = 16;
const DEFAULT_SCROLL_OFFSET = 96;
// Space kept below the tooltip, clear of the demo notice bar at the bottom of the screen.
const BOTTOM_GAP = 72;

function readScrollOffset() {
  const header = document.querySelector("[data-site-header]");
  return header ? Math.ceil(header.getBoundingClientRect().bottom) + SCROLL_GAP : DEFAULT_SCROLL_OFFSET;
}

function usePageTour() {
  // Static hosting serves routes with a trailing slash; tours are keyed without one.
  const pathname = usePathname().replace(/\/+$/, "") || "/";
  const manifest = useCapabilities();
  const tours = manifest.portal.audience === "member" ? memberProductTours : productTours;
  return { pathname, tour: tours[pathname] };
}

// Pages with a tour show a button to replay it.
export function useHasProductTour() {
  return Boolean(usePageTour().tour);
}

export function ProductTourController() {
  const { pathname, tour } = usePageTour();
  const [run, setRun] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(DEFAULT_SCROLL_OFFSET);
  const [instance, setInstance] = useState(0);
  const startToken = useRef(0);
  const storageKey = useMemo(
    () => (tour ? tourStorageKey(pathname, tour.version) : ""),
    [pathname, tour]
  );

  const start = useCallback(() => {
    if (!tour) return;
    const token = ++startToken.current;
    setScrollOffset(readScrollOffset());
    setRun(false);
    setInstance((value) => value + 1);
    window.requestAnimationFrame(() => {
      if (startToken.current === token) setRun(true);
    });
  }, [tour]);

  const markSeen = useCallback(() => {
    if (!storageKey) return;
    startToken.current += 1;
    window.localStorage.setItem(storageKey, "seen");
    setRun(false);
  }, [storageKey]);

  useEffect(() => {
    startToken.current += 1;
    setRun(false);
    if (!tour || window.localStorage.getItem(storageKey) === "seen") return;
    const timer = window.setTimeout(start, 450);
    return () => {
      startToken.current += 1;
      window.clearTimeout(timer);
    };
  }, [pathname, start, storageKey, tour]);

  useEffect(() => {
    const replay = () => start();
    window.addEventListener(START_PRODUCT_TOUR_EVENT, replay);
    return () => window.removeEventListener(START_PRODUCT_TOUR_EVENT, replay);
  }, [start]);

  useEffect(() => {
    if (!run) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") markSeen();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [markSeen, run]);

  const handleEvent = useCallback(
    (event: EventData, controls: { skip: () => void }) => {
      if (event.action === ACTIONS.CLOSE) {
        markSeen();
        controls.skip();
        return;
      }
      if (
        event.type === EVENTS.TOUR_END &&
        (event.status === STATUS.FINISHED || event.status === STATUS.SKIPPED)
      ) {
        markSeen();
      }
    },
    [markSeen]
  );

  if (!tour) return null;

  return (
    <Joyride
      key={`${pathname}-${instance}`}
      continuous
      // A section taller than the screen leaves no room above or below it; the tooltip then moves
      // up or down to stay on screen, between the header and the bottom of the window.
      floatingOptions={{ shiftOptions: { crossAxis: true, padding: { top: scrollOffset, bottom: BOTTOM_GAP, left: 12, right: 12 } } }}
      locale={{
        back: "Back",
        close: "Close tour",
        last: "Finish",
        next: "Next",
        nextWithProgress: "Next ({current} of {total})",
        skip: "Skip tour"
      }}
      onEvent={handleEvent}
      options={{
        backgroundColor: "#ffffff",
        blockTargetInteraction: true,
        buttons: ["back", "skip", "close", "primary"],
        closeButtonAction: "skip",
        dismissKeyAction: "close",
        overlayClickAction: false,
        overlayColor: "rgba(0, 0, 0, 0.55)",
        primaryColor: "#be2c10",
        scrollOffset,
        showProgress: true,
        skipBeacon: true,
        // No padding: a wider cutout showed the page background around full-width sections.
        spotlightPadding: 0,
        spotlightRadius: 0,
        targetWaitTimeout: 6000,
        textColor: "#262626",
        width: 360,
        // Below the sticky site header (z-40): the header covers any part of the spotlight under it.
        zIndex: 35
      }}
      run={run}
      scrollToFirstStep
      steps={tour.steps}
      styles={{
        buttonBack: { color: "#5f5f60" },
        buttonClose: { color: "#262626" },
        buttonPrimary: { borderRadius: 0, fontWeight: 700, padding: "9px 14px" },
        buttonSkip: { color: "#5f5f60" },
        tooltip: { border: "1px solid rgba(0,0,0,0.14)", borderRadius: 0 },
        tooltipContent: { lineHeight: 1.6, textAlign: "left" },
        tooltipTitle: { color: "#262626", fontWeight: 700, textAlign: "left" }
      }}
    />
  );
}
