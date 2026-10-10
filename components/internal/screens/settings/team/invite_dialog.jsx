"use client";

import { useState } from "react";

import { Field } from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
import { Textarea } from "@geiger/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";

export default function InviteDialog({ open, onOpenChange, roles, groups, onSubmit }) {
  // Keyed by `open` in the parent, so this mounts fresh each time it opens —
  // the lazy initializers below reset the form without a set-state effect.
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [groupId, setGroupId] = useState("none");
  const [roleId, setRoleId] = useState(() => {
    const fallback = roles.find((r) => r.key === "member") || roles[roles.length - 1];
    return fallback?.id || "";
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            Add teammates by email. They will get access with the role you choose.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Email addresses" hint="Separate multiple with commas or new lines.">
            <Textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="alex@company.com, sam@company.com"
              rows={3}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Group (optional)">
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Message (optional)">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a personal note"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground"
            onClick={() => onSubmit(emails, roleId, groupId, message)}
          >
            Send invitations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
