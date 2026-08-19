"use client";

import { Download, FileText, Info, KeyRound, Loader, Users } from "lucide-react";
import { toast } from "sonner";

import { useDownloadTenantExport, useTenantExportSummary } from "@/hooks/api/use-tenant-backup";
import { getErrorMessage } from "@heirs/api-client";
import { Button, StatTile } from "@heirs/ui";
import { ErrorState, PageLayout, Skeleton } from "@/components/shared";

const Page = () => {
  const summary = useTenantExportSummary();
  const download = useDownloadTenantExport();

  const onDownload = () =>
    download.mutate(undefined, {
      onSuccess: (payload) =>
        toast.success(
          payload.truncated
            ? "Export downloaded — document history was truncated at the export limit"
            : "Export downloaded",
        ),
      onError: (error) => toast.error(getErrorMessage(error)),
    });

  if (summary.isError)
    return (
      <PageLayout title="Backup">
        <ErrorState
          title="Couldn't load export summary"
          description={getErrorMessage(summary.error)}
          onRetry={() => summary.refetch()}
          retrying={summary.isFetching}
        />
      </PageLayout>
    );

  const counts = summary.data?.counts;

  return (
    <PageLayout
      title="Backup"
      subtitle="Download a copy of your organisation's documents, API keys and team."
      actions={
        <Button onClick={onDownload} disabled={download.isPending || summary.isPending}>
          {download.isPending ? <Loader className="size-4 animate-spin" /> : <Download className="size-4" />}
          Download export
        </Button>
      }
    >
      {summary.isPending ? (
        <Skeleton skeleton="statistics" numberOfCards={3} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <StatTile label="Documents" value={(counts?.documents ?? 0).toLocaleString()} hint="processing history" />
            <StatTile label="API keys" value={(counts?.keys ?? 0).toLocaleString()} hint="metadata only" />
            <StatTile label="Team members" value={(counts?.team ?? 0).toLocaleString()} hint="no passwords" />
          </div>

          {/* Said up front rather than discovered later: this is a record, not a
              disaster-recovery artefact. Restoring it would produce keys that do not
              work and users who cannot sign in. */}
          <section className="space-y-3 rounded-md border bg-muted/40 p-4">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">This is an export, not a restorable backup</p>
                <p className="text-xs text-muted-foreground text-pretty">
                  It is meant for your records and for taking your data elsewhere. The credentials needed to make it
                  restorable are deliberately unrecoverable, so the file cannot recreate working keys or logins.
                </p>
              </div>
            </div>
            <ul className="space-y-1.5 pl-6">
              {(summary.data?.excluded ?? []).map((item) => (
                <li key={item} className="text-xs text-muted-foreground">
                  — {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <p className="text-sm">What&apos;s included</p>
            <ul className="divide-y rounded-md border">
              {[
                { icon: FileText, label: "Documents", detail: "Filename, function, pages, size, outcome and timing." },
                { icon: KeyRound, label: "API keys", detail: "Key hash, label, limits, expiry and status." },
                { icon: Users, label: "Team", detail: "Email, name, role and status for each member." },
              ].map(({ icon: Icon, label, detail }) => (
                <li key={label} className="flex items-start gap-3 px-3 py-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground">{detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </PageLayout>
  );
};

export default Page;
