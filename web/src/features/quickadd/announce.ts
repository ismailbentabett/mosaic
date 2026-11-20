import { type NavigateFunction } from "react-router-dom";
import { cancel } from "../../outbox";
import { feel } from "../../sound";
import { emit, toast } from "../../store";
import { type Saved } from "./save";

/** The toast after a save: undo from the device queue, undo on the server, or open the note. */
export function announce(
  out: Saved,
  restore: () => void,
  navigate: NavigateFunction
) {
  if (out.offlineId) {
    const id = out.offlineId;
    toast(out.toast, {
      action: {
        label: "Undo",
        run: () => {
          void cancel(id).then((ok) => {
            if (ok) {
              feel("undo");
              restore();
              emit(...out.topics);
            } else toast("Already sent. Delete it where it landed.");
          });
        },
      },
      timeout: 7000,
    });
  } else if (out.undo) {
    const undo = out.undo;
    toast(out.toast, {
      action: {
        label: "Undo",
        run: () => {
          undo()
            .then(() => {
              feel("undo");
              emit(...out.topics);
              toast("Undone.");
            })
            .catch(() => toast("Could not undo. Remove it on its screen."));
        },
      },
      timeout: 7000,
    });
  } else if (out.open) {
    const path = out.open;
    toast(out.toast, {
      action: {
        label: "Open",
        run: () =>
          navigate(`/brain/notes/note?path=${encodeURIComponent(path)}`),
      },
    });
  } else toast(out.toast);
}
