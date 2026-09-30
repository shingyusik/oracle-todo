import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { healthApi } from "@/features/health/api/health-api";
import { HealthRecordsInspector } from "@/features/health/ui/HealthRecordsInspector";
import type { HealthEvent } from "@/features/health/model/health-model";

afterEach(() => vi.restoreAllMocks());
it("keeps custom archived metrics inspectable and restores the viewed version", async () => {
  const event: HealthEvent={id:"00000000-0000-4000-8000-000000000001",occurredAt:"2026-09-30T03:00:00Z",category:"lab",metricKey:"custom",name:"Historical custom lab",value:-1,unit:"custom-unit",note:"Reconcile",attributes:{kind:"lab",metricKey:"custom",name:"Historical custom lab",value:-1,unit:"custom-unit"},createdAt:"2026-09-30T03:00:00Z",updatedAt:"2026-09-30T03:00:01Z",deletedAt:"2026-09-30T03:00:01Z"};
  vi.spyOn(healthApi,"records").mockResolvedValue([{kind:"health_event",record:event}]);
  vi.spyOn(healthApi,"audit").mockResolvedValue([{action:"archive",before:{name:event.name},after:{deleted_at:event.deletedAt}}]);
  const restore=vi.spyOn(healthApi,"restoreEvent").mockResolvedValue({...event,deletedAt:null});
  vi.spyOn(window,"confirm").mockReturnValue(true);
  const refresh=vi.fn().mockResolvedValue(undefined);
  const {container}=render(<HealthRecordsInspector onChanged={refresh}/>);
  const details=container.querySelector("details")!;
  details.open=true; fireEvent(details,new Event("toggle"));
  fireEvent.click(await screen.findByRole("button",{name:/Historical custom lab/}));
  expect(await screen.findByText(/custom-unit/, {selector:"pre"})).toBeInTheDocument();
  expect(screen.getByText(/archive/,{selector:"pre"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Restore record"}));
  await waitFor(()=>expect(restore).toHaveBeenCalledWith(event.id,event.updatedAt));
  expect(refresh).toHaveBeenCalledOnce();
});
