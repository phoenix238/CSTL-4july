/**
 * A short tap of haptic feedback, best-effort.
 *
 * Android/Chrome exposes the Vibration API, so `navigator.vibrate` covers it.
 * iOS Safari never has — but since 17.4 a `<input type="checkbox" switch>`
 * fires the system haptic when it's toggled, so a hidden switch that we click
 * is the only way to buzz an iPhone from a web page. Both paths are optional:
 * on a device that does neither, the gesture still works and simply stays
 * silent, which is why nothing here throws or reports failure.
 */

let iosSwitch: HTMLInputElement | null = null;

function iosHaptic(): boolean {
  if (typeof document === "undefined") return false;
  try {
    if (!iosSwitch) {
      const el = document.createElement("input");
      el.type = "checkbox";
      // `switch` is the attribute that makes iOS treat it as a haptic control.
      // It's not in the TS DOM types, hence setAttribute rather than a property.
      el.setAttribute("switch", "");
      el.setAttribute("aria-hidden", "true");
      el.tabIndex = -1;
      el.style.cssText =
        "position:fixed;top:-100px;left:-100px;width:1px;height:1px;opacity:0;pointer-events:none";
      document.body.appendChild(el);
      iosSwitch = el;
    }
    iosSwitch.checked = !iosSwitch.checked;
    iosSwitch.dispatchEvent(new Event("change", { bubbles: false }));
    return true;
  } catch {
    return false;
  }
}

/** Buzz once — used when a long-press turns into a draft event. */
export function haptic(ms = 12): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      if (navigator.vibrate(ms)) return;
    } catch {
      /* fall through to the iOS path */
    }
  }
  iosHaptic();
}
