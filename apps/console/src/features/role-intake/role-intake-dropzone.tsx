"use client";

import * as React from "react";
import { Attachment, Upload } from "iconoir-react";
import { useTranslation } from "react-i18next";

import { cn } from "@prelude/ui";

export function RoleIntakeDropzone({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (file: File) => void;
}) {
  const { t } = useTranslation();
  const [dragActive, setDragActive] = React.useState(false);
  const dragDepth = React.useRef(0);

  const selectFirstFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file && !disabled) {
      onSelect(file);
    }
  };

  return (
    <label
      className={cn(
        "mt-10 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-ink-300 bg-white/72 px-6 text-center transition-colors",
        "hover:border-ink-900 hover:bg-white focus-within:border-ink-900 focus-within:ring-2 focus-within:ring-olive-300",
        dragActive && "border-olive-700 bg-[#f3f4ea]",
        disabled && "pointer-events-none opacity-60",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragActive(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        selectFirstFile(event.dataTransfer.files);
      }}
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef0e3] text-olive-900">
        {dragActive ? (
          <Upload aria-hidden="true" className="h-6 w-6" />
        ) : (
          <Attachment aria-hidden="true" className="h-6 w-6" />
        )}
      </span>
      <span className="mt-4 text-base font-semibold text-ink-900">
        {dragActive
          ? t("roleIntake.upload.dropNow")
          : t("roleIntake.upload.choose")}
      </span>
      <span className="mt-2 text-sm leading-6 text-ink-600">
        {t("roleIntake.upload.dragHint")}
      </span>
      <span className="mt-1 text-xs text-ink-500">
        {t("roleIntake.upload.requirements")}
      </span>
      <input
        accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          selectFirstFile(event.target.files);
          event.currentTarget.value = "";
        }}
        type="file"
      />
    </label>
  );
}
