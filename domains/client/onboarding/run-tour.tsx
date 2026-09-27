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

export function ProductTourController() {
  const pathname = usePathname();
  const manifest = useCapabilities();
  const tours = manifest.portal.audience === "member" ? memberProductTours : productTours;
  const tour = tours[pathname];
  const [run, setRun] = useState(false);
  const [instance, setInstance] = useState(0);
  const startToken = useRef(0);
  const storageKey = useMemo(
    () => (tour ? tourStorageKey(pathname, tour.version) : ""),
    [pathname, tour]
  );

  const start = useCallback(() => {
    if (!tour) return;
    const token = ++startToken.current;
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
        backgroundColor: "#141416",
        blockTargetInteraction: true,
        buttons: ["back", "skip", "close", "primary"],
        closeButtonAction: "skip",
        dismissKeyAction: "close",
        overlayClickAction: false,
        overlayColor: "rgba(0, 0, 0, 0.72)",
        primaryColor: "#e8590c",
        showProgress: true,
        skipBeacon: true,
        spotlightPadding: 8,
        spotlightRadius: 10,
        targetWaitTimeout: 6000,
        textColor: "#FFF7ED",
        width: 360,
        zIndex: 1000
      }}
      run={run}
      scrollToFirstStep
      steps={tour.steps}
      styles={{
        buttonBack: { color: "#FFF7ED", opacity: 0.72 },
        buttonClose: { color: "#FFF7ED" },
        buttonPrimary: { borderRadius: 8, fontWeight: 700, padding: "9px 14px" },
        buttonSkip: { color: "#FFF7ED", opacity: 0.62 },
        tooltip: { border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 },
        tooltipContent: { lineHeight: 1.6, textAlign: "left" },
        tooltipTitle: { color: "#FFF7ED", fontWeight: 700, textAlign: "left" }
      }}
    />
  );
}
