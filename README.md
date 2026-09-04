# Pack Builder

Drop HTML, Word (.docx), or PowerPoint (.pptx) specs, edit them, and download one client documentation file. A downloaded pack can be dropped back in to keep editing.

## Use it online

The app lives at **[github.com/davo1100/pack-builder](https://github.com/davo1100/pack-builder)**. Connect that repo in Render (New → Blueprint) so every push to `main` goes live. Colleagues open the Render URL in a browser — no Python install, no zip, no `.bat` file.

Dropped files are sent to the server for that convert/build request, processed in memory, and discarded. Nothing is kept. The HTML you download is still what you send to clients.

Old `.doc` and `.ppt` files are not converted in the cloud (no Microsoft Office). Save them as `.docx` or `.pptx` first.

## Run it on your computer

1. If Python is missing, install Python 3 from https://www.python.org/downloads/ (free). On the **first installer screen**, tick **Add python.exe to PATH**, then click **Install Now**.
2. Double-click `Start Pack Builder.bat`. A command window stays open and the studio opens at http://127.0.0.1:8787/studio.html.
3. Drop HTML, Word, or PowerPoint files (and attachments for diagrams), edit, then download the pack.

Leave the command window open while you work. Close it to stop.

Locally you can also put files in `inbox/` or `source/` and click **Import from this project**. That button is hidden on the hosted app.

## Deploy from GitHub (Render)

1. Push this repo to GitHub (client specs in `source/` are gitignored so they are not published).
2. In [Render](https://render.com), sign in with GitHub → **New** → **Blueprint** and select this repo, or **New Web Service** and point it at the repo. `render.yaml` sets the start command to `python studio.py`.
3. After the first deploy, the service URL is the live Pack Builder. Later pushes to `main` replace it.

Free Render instances sleep when idle; the first visit after a pause can take about 30 seconds.

## Notes

- No extra Python packages.
- The hosted app only serves the builder UI (`studio.html`, `css/`, `js/`, `data/`, `assets/`). It does not expose `source/` or other project files.
