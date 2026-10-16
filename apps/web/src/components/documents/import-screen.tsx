// Copyright (c) 2026, Rademics. All rights reserved.
// Import from Excel (plan 10 §1.C; decisions 77, 78: file upload only).
// 1. Choose what to import and how, and download the template.
// 2. Upload the filled file: columns are matched by name (and can be
//    re-matched), and every row is checked; nothing is saved yet.
// 3. Import: the server saves the rows in the background while this screen
//    follows its progress, then shows what was added or changed and which rows
//    failed, with the failed rows to download, fix and import again.
"use client";

import { useEffect, useId, useState } from "react";
import { hasPermission, IMPORT_MODES, type ImportMode } from "shared";
import { Alert, Badge, Button, DataTable, Field, RadioInput, SelectInput, type Column } from "@/components/ui";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { IMPORT_MODE_LABELS, IMPORT_STATUS_LABELS, importFileNames, type ImportFieldDto, type ImportJobDto, type ImportKindDto, type ImportPreviewDto, type ImportStatusDto, importStatusTone } from "@/lib/documents";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const FIELD_TYPE_HINTS: Record<ImportFieldDto["type"], string> = {
  text: "Text",
  code: "Text (keep the zeros at the front)",
  number: "A number, e.g. 1,05,000.50",
  date: "A date, e.g. 16/10/2026",
  yesno: "Yes or No",
};

interface ImportScreenProps {
  /** How often the progress of a running import is read (milliseconds). */
  pollMs?: number;
}

export function ImportScreen({ pollMs = 1000 }: ImportScreenProps) {
  const { user, loading } = useAuth();
  const allowed = hasPermission(user, "import.masters") || hasPermission(user, "import.opening");
  const kinds = useLoad<ImportKindDto[]>(() => (allowed ? api.get<ImportKindDto[]>("/imports/kinds") : Promise.resolve([])), [allowed]);
  const jobs = useLoad<ImportJobDto[]>(() => (allowed ? api.get<ImportJobDto[]>("/imports") : Promise.resolve([])), [allowed]);
  const reloadJobs = jobs.reload;
  const fileId = useId();

  const [kindKey, setKindKey] = useState("");
  const [mode, setMode] = useState<ImportMode>("add");
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [status, setStatus] = useState<ImportStatusDto | null>(null);
  const [busy, setBusy] = useState<"template" | "preview" | "run" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Changes to empty the file box when starting again.
  const [fileBox, setFileBox] = useState(0);

  // Follow a running import until the server says it has finished.
  useEffect(() => {
    if (!status || status.status !== "running") return;
    const id = status.id;
    const t = setTimeout(() => {
      api.get<ImportStatusDto>(`/imports/${id}`).then(
        (next) => {
          setStatus(next);
          if (next.status !== "running") void reloadJobs();
        },
        (err: unknown) => setError(errorMessage(err)),
      );
    }, pollMs);
    return () => clearTimeout(t);
    // Re-armed after every answer (each answer is a new status object).
  }, [status, pollMs, reloadJobs]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!allowed) {
    return (
      <>
        <h1>Import from Excel</h1>
        <Alert kind="error">You do not have the right to import. Ask the owner if you need it.</Alert>
      </>
    );
  }

  const kindList = kinds.data ?? [];
  const kind = kindList.find((k) => k.kind === kindKey) ?? kindList[0] ?? null;
  const running = status?.status === "running";

  function startAgain() {
    setFile(null);
    setPreview(null);
    setMapping({});
    setStatus(null);
    setError(null);
    setFileBox((n) => n + 1);
  }

  async function check(f: File, map: Record<string, string>, m: ImportMode = mode) {
    if (!kind) return;
    setBusy("preview");
    setError(null);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("options", JSON.stringify({ kind: kind.kind, mode: m, ...(Object.keys(map).length ? { mapping: map } : {}) }));
      setPreview(await api.upload<ImportPreviewDto>("/imports/preview", form));
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function template() {
    if (!kind) return;
    setBusy("template");
    setError(null);
    try {
      await downloadFile(`/imports/templates/${kind.kind}`, importFileNames.template(kind.kind));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!preview) return;
    setBusy("run");
    setError(null);
    try {
      const started = await api.post<ImportStatusDto>(`/imports/${preview.jobId}/run`);
      setStatus(started);
      if (started.status !== "running") void jobs.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function failedRows(job: { id: string; kind: string }) {
    setBusy("failed");
    setError(null);
    try {
      await downloadFile(`/imports/${job.id}/failed-rows`, importFileNames.failedRows(job.kind));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function rematch(heading: string, field: string) {
    if (!file) return;
    const next = { ...mapping, [heading]: field };
    setMapping(next);
    void check(file, next);
  }

  const fieldColumns: Column<ImportFieldDto>[] = [
    { key: "label", header: "Column", render: (f) => <strong>{f.label}</strong> },
    { key: "required", header: "Needed", render: (f) => (f.required ? "Yes" : <span className="muted">No</span>) },
    { key: "what", header: "What to put in it", render: (f) => f.hint ?? FIELD_TYPE_HINTS[f.type] },
  ];

  return (
    <>
      <h1>Import from Excel</h1>
      <p className="muted">Bring lists in from a spreadsheet: download the template, fill it in Excel, upload it, check what was found, then import. Nothing is saved until you press Import.</p>
      <Alert kind="error">{kinds.error ?? error}</Alert>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>1. What to import</h2>
        {kinds.data && kindList.length === 0 ? <Alert kind="info">There is nothing you are allowed to import.</Alert> : null}
        <SelectInput
          id="import-kind"
          label="What the file holds"
          value={kind?.kind ?? ""}
          disabled={running}
          onChange={(e) => {
            setKindKey(e.target.value);
            startAgain();
          }}
        >
          {kindList.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </SelectInput>
        <div className="actions" style={{ marginTop: 8, marginBottom: 12, alignItems: "center" }}>
          <Button busy={busy === "template"} disabled={!kind} onClick={() => void template()}>
            Download the template
          </Button>
          <span className="field-hint" style={{ margin: 0 }}>
            An Excel file with the right columns and one example row.
          </span>
        </div>
        <fieldset>
          <legend>How to import</legend>
          {IMPORT_MODES.map((m) => (
            <RadioInput
              key={m}
              id={`import-mode-${m}`}
              name="import-mode"
              label={IMPORT_MODE_LABELS[m].label}
              description={IMPORT_MODE_LABELS[m].explain}
              checked={mode === m}
              disabled={running}
              onChange={() => {
                setMode(m);
                if (file && !status) void check(file, mapping, m);
              }}
            />
          ))}
        </fieldset>
        <Alert kind="info">
          Barcodes, HSN codes, mobile numbers and codes must stay as <strong>text</strong>, or Excel drops the zeros at the front (0902 becomes 902). The template already formats those columns as text; when pasting into it, use Paste Special → Values. Amounts may be written the Indian way (1,05,000.50) and dates as 16/10/2026.
        </Alert>
        {kind ? (
          <details>
            <summary>The columns of {kind.label.toLowerCase()}</summary>
            <DataTable columns={fieldColumns} rows={kind.fields} rowKey={(f) => f.key} />
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>2. Upload your file</h2>
        <Field id={fileId} label="The filled-in file" hint="An Excel file (.xlsx) or a CSV file. It is read and checked; nothing is saved yet.">
          <input
            key={fileBox}
            id={fileId}
            className="input"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            disabled={!kind || running || busy === "preview"}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setMapping({});
              setStatus(null);
              if (f) void check(f, {});
              else setPreview(null);
            }}
          />
        </Field>
        {busy === "preview" ? <p className="muted">Reading and checking the file…</p> : null}
        {preview ? <PreviewPanel preview={preview} disabled={running || busy !== null || !!status} onRematch={rematch} /> : null}
      </section>

      {preview ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>3. Import</h2>
          {!status ? (
            <>
              <p>
                {preview.ready === preview.rows ? "Every row is ready." : `${preview.ready} of ${preview.rows} rows are ready; rows with problems are skipped, so you can fix them and import them later.`}
              </p>
              <div className="actions">
                <Button variant="primary" busy={busy === "run"} disabled={preview.ready === 0 || preview.missingRequired.length > 0} onClick={() => void run()}>
                  Import {preview.ready} row{preview.ready === 1 ? "" : "s"}
                </Button>
                <Button onClick={startAgain}>Start again</Button>
              </div>
            </>
          ) : (
            <RunPanel status={status} downloading={busy === "failed"} onFailedRows={() => void failedRows(status)} onAgain={startAgain} />
          )}
        </section>
      ) : null}

      <PastImports jobs={jobs.data} loading={jobs.loading} error={jobs.error} downloading={busy === "failed"} onFailedRows={(j) => void failedRows(j)} />
    </>
  );
}

function PreviewPanel({ preview, disabled, onRematch }: { preview: ImportPreviewDto; disabled: boolean; onRematch: (heading: string, field: string) => void }) {
  const columns = preview.columns.filter((c): c is { heading: string; field: string | null; label: string | null } => !!c.heading && c.heading.trim() !== "");
  const used = new Set(columns.map((c) => c.field).filter(Boolean));
  const shown = preview.problems.length;
  const withProblems = preview.rows - preview.ready;
  return (
    <div className="import-preview">
      <p>
        <strong>{preview.fileName}</strong>: {preview.rows} row{preview.rows === 1 ? "" : "s"} found, <strong>{preview.ready} ready</strong>
        {withProblems ? `, ${withProblems} with problems` : ""}.
      </p>
      {preview.missingRequired.length ? (
        <Alert kind="error">
          These columns are needed but were not found: <strong>{preview.missingRequired.join(", ")}</strong>. Add them to the file, or match one of your columns to them below.
        </Alert>
      ) : null}

      <h3>Columns in your file</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Column in your file</th>
              <th scope="col">Read as</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.heading} className={c.field ? undefined : "row-muted"}>
                <td>{c.heading}</td>
                <td>
                  <select className="input" aria-label={`Read “${c.heading}” as`} value={c.field ?? ""} disabled={disabled} onChange={(e) => onRematch(c.heading, e.target.value)}>
                    <option value="">Not used (skip this column)</option>
                    {preview.fields.map((f) => (
                      <option key={f.key} value={f.key} disabled={used.has(f.key) && c.field !== f.key}>
                        {f.label}
                        {f.required ? " (needed)" : ""}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.unmatched.length ? <p className="field-hint">Not matched, so not used: {preview.unmatched.join(", ")}. Choose what they hold above if they should be read.</p> : null}

      {shown ? (
        <>
          <h3>Problems by row</h3>
          <p className="field-hint">Row numbers are the rows of the spreadsheet (the heading is row 1).{withProblems > shown ? ` The first ${shown} are shown.` : ""}</p>
          <DataTable
            columns={[
              { key: "row", header: "Row", render: (p) => `Row ${p.rowNumber}` },
              { key: "problem", header: "Problem", render: (p) => p.problems.join("; ") },
            ]}
            rows={preview.problems}
            rowKey={(p) => String(p.rowNumber)}
            rowClassName={() => "row-warn"}
          />
        </>
      ) : null}
    </div>
  );
}

function RunPanel({ status, downloading, onFailedRows, onAgain }: { status: ImportStatusDto; downloading: boolean; onFailedRows: () => void; onAgain: () => void }) {
  if (status.status === "running") {
    return (
      <div aria-live="polite">
        <p>
          Importing… {status.done} of {status.totalRows} rows done.
        </p>
        <progress className="import-progress" max={Math.max(1, status.totalRows)} value={status.done} aria-label="Rows done" />
        <p className="field-hint">You can leave this page; the import carries on and appears under Past imports.</p>
      </div>
    );
  }
  return (
    <div aria-live="polite">
      <p>
        <Badge kind={importStatusTone(status.status)}>{IMPORT_STATUS_LABELS[status.status]}</Badge>
      </p>
      {status.message ? <Alert kind={status.status === "failed" ? "error" : "info"}>{status.message}</Alert> : null}
      <div className="tiles">
        <Count label="Added" value={status.added} />
        <Count label="Changed" value={status.changed} />
        <Count label="Nothing to change" value={status.unchanged} />
        <Count label="Failed" value={status.failed} />
      </div>
      {status.failed > 0 ? (
        <>
          <h3>Rows that failed</h3>
          <p className="field-hint">Download them, fix the problems in Excel and import that file again. Rows already done are skipped.</p>
          <DataTable
            columns={[
              { key: "row", header: "Row", render: (r) => `Row ${r.rowNumber}` },
              { key: "problem", header: "Problem", render: (r) => r.message ?? "—" },
            ]}
            rows={status.failedRows}
            rowKey={(r) => String(r.rowNumber)}
          />
        </>
      ) : null}
      <div className="actions">
        {status.failed > 0 ? (
          <Button variant="primary" busy={downloading} onClick={onFailedRows}>
            Download the failed rows
          </Button>
        ) : null}
        <Button onClick={onAgain}>Import another file</Button>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="tile">
      <p className="tile-label">{label}</p>
      <p className="tile-value">{value}</p>
    </div>
  );
}

function PastImports({ jobs, loading, error, downloading, onFailedRows }: { jobs: ImportJobDto[] | null; loading: boolean; error: string | null; downloading: boolean; onFailedRows: (j: ImportJobDto) => void }) {
  // Files that were only checked and never imported are left out.
  const rows = jobs?.filter((j) => j.status !== "previewed") ?? null;
  const columns: Column<ImportJobDto>[] = [
    { key: "when", header: "When", render: (j) => <span style={{ whiteSpace: "nowrap" }}>{formatDateTime(j.startedAt ?? j.createdAt)}</span> },
    { key: "what", header: "What", render: (j) => j.kindLabel },
    { key: "file", header: "File", render: (j) => j.fileName },
    { key: "how", header: "How", render: (j) => IMPORT_MODE_LABELS[j.mode]?.label ?? j.mode },
    { key: "status", header: "Result", render: (j) => <Badge kind={importStatusTone(j.status)}>{IMPORT_STATUS_LABELS[j.status] ?? j.status}</Badge> },
    { key: "rows", header: "Rows", align: "right", render: (j) => j.totalRows },
    { key: "added", header: "Added", align: "right", render: (j) => j.added },
    { key: "changed", header: "Changed", align: "right", render: (j) => j.changed },
    { key: "failed", header: "Failed", align: "right", render: (j) => j.failed },
    {
      key: "download",
      header: "",
      render: (j) =>
        j.failed > 0 && j.status !== "running" ? (
          <Button size="small" busy={downloading} onClick={() => onFailedRows(j)} aria-label={`Download the failed rows of ${j.fileName}`}>
            Failed rows
          </Button>
        ) : null,
    },
  ];
  return (
    <section>
      <h2>Past imports</h2>
      <Alert kind="error">{error}</Alert>
      <DataTable columns={columns} rows={rows} rowKey={(j) => j.id} loading={loading} empty="Nothing has been imported yet." />
    </section>
  );
}
