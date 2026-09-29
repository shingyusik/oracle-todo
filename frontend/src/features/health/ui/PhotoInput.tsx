"use client";

import React from "react";
import { IconPhotoPlus } from "@tabler/icons-react";

export const PhotoInput = React.forwardRef<HTMLInputElement, {
  selectedName?: string;
  disabled?: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
}>(function PhotoInput({ selectedName, disabled, onChange }, ref) {
  return (
    <span className="photo-upload-area">
      <input
        ref={ref}
        type="file"
        aria-label="Photo"
        accept="image/*"
        className="photo-upload-input"
        disabled={disabled}
        onChange={onChange}
      />
      <IconPhotoPlus size={24} stroke={1.5} aria-hidden="true" />
      <span className="photo-upload-caption">{selectedName ?? "Click to add a photo"}</span>
    </span>
  );
});
