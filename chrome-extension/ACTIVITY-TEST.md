# Activity experiment — extension 1.1.6

## Install and use

Pull `improved-ui`, reload Oraforge eTIMS Companion at `chrome://extensions`,
then refresh the existing KRA popup. In the green Oraforge panel expand
**Activity keep-alive · Experimental**, choose **Mouse activity**, and enable
**Activity every 60 seconds**. The extension popup and Options expose the same
settings. Existing ON/OFF preference is retained. Mouse is the new default mode;
the previous scroll experiment remains selectable.

Mouse mode dispatches two bubbling synthetic `mousemove` events every minute on
the page body. It works without a scrollbar and does not move the physical cursor,
click, focus an input, type, refresh a page, or submit an invoice. These events
remain `isTrusted=false`. No authentication tokens or credentials are accessed.

A Chrome background alarm supplements the page timer. Concurrent timer and alarm
ticks are deduplicated. Neither mechanism can wake a sleeping computer or execute
inside a discarded tab. Both modes pause during recent real cashier input or an
offline state, and stop on detected login/OTP/expired-session screens. Scroll mode
also pauses while dialogs are open.

## Read the results correctly

- `mouse_cycle`: synthetic mouse events were dispatched, **not** proof of renewal.
- `scroll_cycle`: the previous physical page-scroll experiment ran.
- `timer_delayed`: a gap over 90 seconds occurred; `gap_ms` gives its duration.
- `logged_out`: the extension detected a login or expired-session screen.
- `session_detected`: authenticated-looking page controls were found. This is
  `session_evidence: page_only`; it is not a server authentication check.

Compare OFF and Mouse sessions on the same page with the computer awake. Leave
the portal untouched beyond its usual timeout, then use ordinary read-only portal
navigation to check whether the session is still accepted. No invoice generation
is needed. Download logs if it expires again; they contain timing/mode metadata,
not invoice values, URL paths, tokens, passwords or customer details.

## Known limits and evidence

The user's live test showed that scroll cycles can occur while logout still
happens. Public eCitizen JavaScript inspected on 2026-10-11
(`/assets/itax/main-0198ee80.js`) includes logout on an HTTP 401 response. This does
not establish the timeout cause, its duration, or a supported renewal endpoint.
No verified mouse-based renewal mechanism was found. Therefore this change is an
experiment, not a permanent session fix. If mouse mode also fails despite regular
cycles, inspect the actual authenticated network flow before adding any heartbeat;
do not guess endpoints or replay invoice requests.

Chrome alarms documentation:
https://developer.chrome.com/docs/extensions/reference/api/alarms

Validation: Node/JSDOM invoice and activity regression tests pass. The existing
Chrome scroll test now selects Scroll explicitly. Live authenticated KRA timeout
behavior has not been tested here. A Chrome binary could not be installed in the
development environment (download returned an invalid archive), so this release
does not claim a new real-browser validation run.
