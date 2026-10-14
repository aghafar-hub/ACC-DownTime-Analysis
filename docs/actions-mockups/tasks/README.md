# Tasks inside actions: design mockups

Static design mockups with illustrative data. No app code was changed. The chrome matches the current app: the 68 px navy icon rail, the top bar with breadcrumb, search, Settings, bell and user, the page tabs row, and ACC orange `#B45309` for primary buttons. Desktop screens are 1440 px wide at 1.5x; long pages are captured at full height. Phone screens are 390 × 844 at 2x.

The model has two levels. An **Action** is the problem, from one event or a group of events with the same equipment and reason. Each action holds several **Tasks**, which are the work.

- Action status: Draft → Open → In progress → Closed, or Cancelled. The tasks set it: an action moves to In progress as soon as any task starts.
- Task status: Open → Contractor informed → Waiting stoppage → In progress → Done, or Not needed. Tasks are never deleted.

| File | Screen |
|---|---|
| `01-actions-board.png` | Actions board with the new page tabs (Actions · Tasks · Shutdown list). Each card shows a task progress bar (“2 / 5 tasks done”), the next task with its owner and due date, chips for who still has open tasks, the action owner and the stop need. The columns are Draft / Open / In progress / Closed, with Cancelled hidden behind “Show cancelled”. The summary cards show open tasks by status, **tasks overdue** and **ready to close**. |
| `02-action-detail-tasks.png` | Action detail drawer. **Tasks** is the main section: each row has a status chip, owner (contractor/team chip and person), due date (red when overdue), stop hours, and the buttons **Add task** and **Apply template**. Task 3 is expanded to show its notes and its own history. The action stepper is Draft → Open → In progress → Closed. “Close action” is locked while tasks are open. |
| `03-action-ready-to-close.png` | The same action once all 5 tasks are done (4 done, 1 not needed). A green banner says “All tasks done — ready to close”, with a required closing note and the **Close action** button. A note says Close is only for the people in Settings › Who can close. The effectiveness check starts on close. |
| `04-add-edit-task.png` | Add/edit task dialog. Fields: task title, owner type (Contractor / Team), owner (defaults to the area contractor), person, due date with quick +3/+7/+14/+30 d, status (read-only here), **Needs stoppage** toggle with optional estimated stop hours, and notes. |
| `05-task-status-change.png` | Status popover on a task. It lists the 6 statuses. Contractor informed is disabled for internal-team tasks. Done needs a short note and Not needed needs a reason. |
| `06-create-action-template.png` | New action dialog with a template picker: Repeated failure (suggested), Long stop, Planned overrun, No template. The task list is pre-filled and can be edited: tick boxes, title, owner/person, due offset, stop toggle. |
| `07-shutdown-work-list.png` | **Shutdown list** tab: all open tasks marked “needs stoppage”, grouped by area with the area's line and contractor. Each group shows totals (tasks, estimated hours, longest waiting) and its own Print button. Filters cover area, line, contractor, owner and status. The page has Print and Excel buttons. |
| `08-tasks-list.png` | **Tasks** tab: every task across all actions in one table. Quick filters: My tasks / All open / Overdue / Needs stoppage / Done. Further filters: owner, person, status, area, line. Overdue tasks are listed first. |
| `09-notifications.png` | Notifications page with the Actions category open, and the bell dropdown open. Items include “AC-202610-0012 · all tasks done — ready to close” (sent to the Who-can-close list) and “Task overdue” (sent to the task's person and the action owner). |
| `10-settings-task-templates.png` | Settings › Actions & targets › new section **c Task templates**. It lists the templates and an editor for the selected one. Each task has a default owner (“Area contractor” resolves to RHI or ASEC by area, or a fixed team), a due offset, a needs-stop setting and estimated hours. Each template also says which auto rules suggest it first. |
| `11-phone-action-tasks.png` | Phone: action detail with tasks as cards. |
| `12-phone-task-status.png` | Phone: task status bottom sheet. Done needs a note. |
| `13-phone-shutdown-list.png` | Phone: shutdown list filtered to K.1. |

## Points for the owner to confirm

1. **“Check after 60 days”** in the Repeated failure and Long stop templates is not a real task in the mockups. It is the action's existing 60-day effectiveness check, which starts on close. As a task it would block closing for 60 days.
2. **The board cannot be dragged** between Open and In progress, because the tasks set the status. Only Draft → Open (accept) and Close/Cancel stay manual.
3. **“Contractor informed”** can only be chosen for RHI/ASEC tasks. It is disabled for internal-team tasks.
4. **Not needed** needs a reason, the same way Done needs a note.
5. **Who gets the overdue alert:** the task's person and the action owner. The Actions badge on the rail counts overdue tasks (▲ 6).
6. **Action due date** is no longer set by hand. It follows the latest task due date.
7. **Shutdown list** groups by area and shows its line and contractor. It has no planned-stop calendar, because the app has no stop dates. A “next stop” date per area could be added later.
8. **Page tabs** on Actions: Actions · Tasks · Shutdown list.
