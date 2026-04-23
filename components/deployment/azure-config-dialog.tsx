"use client";

// ---------------------------------------------------------------------------
// Azure Deployment Configuration Dialog
//
// Collects Azure Service Principal credentials before deployment.
// Mirrors the API key dialog pattern in conversion-panel.tsx.
// Pure local state + props — zero Zustand selectors (React 19 safe).
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from "react";
import { Cloud, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { AzureConfig } from "@/lib/types";

const AZURE_CONFIG_STORAGE_KEY = "azure-deploy-config";

const INPUT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono";

interface AzureConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (config: AzureConfig) => void;
}

export function AzureConfigDialog({
  open,
  onOpenChange,
  onSubmit,
}: AzureConfigDialogProps) {
  const [subscriptionId, setSubscriptionId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [rememberForSession, setRememberForSession] = useState(true);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Pre-populate from sessionStorage when dialog opens
  useEffect(() => {
    if (open) {
      try {
        const cached = sessionStorage.getItem(AZURE_CONFIG_STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as AzureConfig;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage hydration; setState sequence is the intended pattern
          setSubscriptionId(parsed.subscriptionId ?? "");
          setTenantId(parsed.tenantId ?? "");
          setClientId(parsed.clientId ?? "");
          setClientSecret(parsed.clientSecret ?? "");
        }
      } catch {
        // Ignore parse errors
      }
      // Focus the first input after dialog animation
      const timer = setTimeout(() => firstInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleSubmit = useCallback(() => {
    const config: AzureConfig = {
      subscriptionId: subscriptionId.trim(),
      tenantId: tenantId.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    };

    if (rememberForSession) {
      sessionStorage.setItem(AZURE_CONFIG_STORAGE_KEY, JSON.stringify(config));
    }

    onOpenChange(false);
    onSubmit(config);
  }, [
    subscriptionId,
    tenantId,
    clientId,
    clientSecret,
    rememberForSession,
    onOpenChange,
    onSubmit,
  ]);

  const isValid =
    subscriptionId.trim() &&
    tenantId.trim() &&
    clientId.trim() &&
    clientSecret.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            Azure Deployment Configuration
          </DialogTitle>
          <DialogDescription>
            Enter your Azure Service Principal credentials to deploy and test
            the Terraform configuration. Credentials are stored only for this
            browser session and are never saved to disk.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isValid) handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label
              htmlFor="azure-subscription-id"
              className="text-sm font-medium leading-none"
            >
              Subscription ID
            </label>
            <input
              ref={firstInputRef}
              id="azure-subscription-id"
              type="text"
              value={subscriptionId}
              onChange={(e) => setSubscriptionId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className={INPUT_CLASSNAME}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="azure-tenant-id"
              className="text-sm font-medium leading-none"
            >
              Tenant ID
            </label>
            <input
              id="azure-tenant-id"
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className={INPUT_CLASSNAME}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="azure-client-id"
              className="text-sm font-medium leading-none"
            >
              Client ID (App ID)
            </label>
            <input
              id="azure-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className={INPUT_CLASSNAME}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="azure-client-secret"
              className="text-sm font-medium leading-none"
            >
              Client Secret
            </label>
            <input
              id="azure-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Service principal password"
              className={INPUT_CLASSNAME}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="azure-remember-session"
              checked={rememberForSession}
              onChange={(e) => setRememberForSession(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <label
              htmlFor="azure-remember-session"
              className="text-sm text-muted-foreground"
            >
              Remember for this session
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              <Rocket className="h-3.5 w-3.5" />
              Deploy & Test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
