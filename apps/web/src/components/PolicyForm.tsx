import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Policy } from '@settle/shared';
import { usePolicy, useUpdatePolicy } from '../api/queries';
import { parseDollarsToCents, centsToDollarsString } from '../lib/money';
import { TEST_IDS } from '../testids';

export const policyFormZodSchema = z.object({
  maxDiscountPct: z.coerce
    .number({ invalid_type_error: 'Must be an integer' })
    .int('Must be a whole number')
    .min(0, 'Cannot be negative')
    .max(100, 'Maximum allowed discount is 100%'),
  maxInstalments: z.coerce
    .number({ invalid_type_error: 'Must be an integer' })
    .int('Must be a whole number')
    .min(1, 'Minimum is 1 instalment')
    .max(12, 'Maximum is 12 instalments'),
  autoApproveDollars: z
    .string()
    .trim()
    .refine((val) => parseDollarsToCents(val) !== null, {
      message: 'Enter a valid dollar amount (e.g. 500.00, max 2 decimals, positive)',
    }),
  requireApprovalFor: z.array(z.enum(['OFFER_DISCOUNT', 'OFFER_INSTALMENTS', 'ESCALATE'])),
  quietHoursStart: z.coerce
    .number({ invalid_type_error: 'Must be an integer' })
    .int('Must be a whole number')
    .min(0, 'Hour must be 0 to 23')
    .max(23, 'Hour must be 0 to 23'),
  quietHoursEnd: z.coerce
    .number({ invalid_type_error: 'Must be an integer' })
    .int('Must be a whole number')
    .min(0, 'Hour must be 0 to 23')
    .max(23, 'Hour must be 0 to 23'),
  maxRemindersPerInvoicePerWeek: z.coerce
    .number({ invalid_type_error: 'Must be an integer' })
    .int('Must be a whole number')
    .min(0, 'Cannot be negative')
    .max(14, 'Maximum is 14 reminders per week'),
});

export type PolicyFormValues = z.infer<typeof policyFormZodSchema>;

export const PolicyForm: React.FC = () => {
  const { data: policy, isLoading, error: loadError, refetch } = usePolicy();
  const updatePolicyMutation = useUpdatePolicy();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty, isValid, isSubmitting },
  } = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormZodSchema),
    mode: 'onChange',
    defaultValues: {
      maxDiscountPct: 0,
      maxInstalments: 1,
      autoApproveDollars: '0.00',
      requireApprovalFor: [],
      quietHoursStart: 0,
      quietHoursEnd: 0,
      maxRemindersPerInvoicePerWeek: 0,
    },
  });

  // Populate initial values when policy loads
  useEffect(() => {
    if (policy) {
      reset({
        maxDiscountPct: policy.maxDiscountPct,
        maxInstalments: policy.maxInstalments,
        autoApproveDollars: centsToDollarsString(policy.autoApproveMaxAmount),
        requireApprovalFor: [...policy.requireApprovalFor],
        quietHoursStart: policy.quietHours.startHour,
        quietHoursEnd: policy.quietHours.endHour,
        maxRemindersPerInvoicePerWeek: policy.maxRemindersPerInvoicePerWeek,
      });
    }
  }, [policy, reset]);

  // Auto-dismiss toast after 4s
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const onSubmit = async (values: PolicyFormValues) => {
    setServerError(null);
    const autoApproveCents = parseDollarsToCents(values.autoApproveDollars);
    if (autoApproveCents === null) {
      return;
    }

    const newPolicy: Policy = {
      maxDiscountPct: values.maxDiscountPct,
      maxInstalments: values.maxInstalments,
      autoApproveMaxAmount: autoApproveCents,
      requireApprovalFor: values.requireApprovalFor,
      quietHours: {
        startHour: values.quietHoursStart,
        endHour: values.quietHoursEnd,
      },
      maxRemindersPerInvoicePerWeek: values.maxRemindersPerInvoicePerWeek,
    };

    try {
      await updatePolicyMutation.mutateAsync(newPolicy);
      setToastMessage('Policy saved');
      reset(values); // reset dirty flag with updated values
    } catch (err: unknown) {
      setServerError((err as Error)?.message || 'Failed to save policy');
    }
  };

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded p-6 space-y-4 animate-pulse max-w-2xl">
        <div className="h-6 w-48 bg-slate-200 rounded" />
        <div className="space-y-3 pt-4">
          <div className="h-10 bg-slate-100 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-6 text-center space-y-3 max-w-2xl">
        <div className="text-sm font-semibold text-status-red">Failed to load policy rules</div>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-white border border-red-300 text-status-red hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          data-testid={TEST_IDS.toast}
          className="flex items-center justify-between p-3 bg-green-50 text-green-900 border border-green-300 rounded text-sm font-medium"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-600" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-xs text-green-700 hover:text-green-900 font-semibold"
            aria-label="Dismiss toast"
          >
            &times;
          </button>
        </div>
      )}

      {/* Server Error Alert with Retry */}
      {serverError && (
        <div
          role="alert"
          className="flex items-center justify-between p-3 bg-red-50 text-red-900 border border-red-300 rounded text-sm"
        >
          <span>{serverError}</span>
          <button
            type="button"
            onClick={handleSubmit(onSubmit)}
            className="text-xs text-red-700 hover:text-red-900 font-semibold underline ml-4"
          >
            Retry
          </button>
        </div>
      )}

      <form
        data-testid={TEST_IDS.policyForm}
        onSubmit={handleSubmit(onSubmit)}
        className="bg-surface border border-border rounded p-6 space-y-6"
      >
        <div className="border-b border-border pb-3">
          <h2 className="text-base font-semibold text-ink">Autonomous Collections Guardrails</h2>
          <p className="text-xs text-muted mt-0.5">
            Define safety boundaries, approval thresholds, and contact limits for Settle's agent.
          </p>
        </div>

        {/* 1. Max Discount Percentage */}
        <div className="space-y-1">
          <label htmlFor="maxDiscountPct" className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Maximum Allowed Discount (%)
          </label>
          <input
            id="maxDiscountPct"
            type="number"
            data-testid={TEST_IDS.policyMaxDiscount}
            {...register('maxDiscountPct')}
            aria-describedby={errors.maxDiscountPct ? 'maxDiscountPct-error' : undefined}
            className={`w-full px-3 py-2 border rounded text-sm tabular focus:outline-none focus:ring-2 focus:ring-accent ${
              errors.maxDiscountPct ? 'border-red-500' : 'border-border'
            }`}
          />
          {errors.maxDiscountPct && (
            <p id="maxDiscountPct-error" className="text-xs text-red-600 font-medium">
              {errors.maxDiscountPct.message}
            </p>
          )}
        </div>

        {/* 2. Max Instalments */}
        <div className="space-y-1">
          <label htmlFor="maxInstalments" className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Maximum Instalment Count (1..12)
          </label>
          <input
            id="maxInstalments"
            type="number"
            data-testid={TEST_IDS.policyMaxInstalments}
            {...register('maxInstalments')}
            aria-describedby={errors.maxInstalments ? 'maxInstalments-error' : undefined}
            className={`w-full px-3 py-2 border rounded text-sm tabular focus:outline-none focus:ring-2 focus:ring-accent ${
              errors.maxInstalments ? 'border-red-500' : 'border-border'
            }`}
          />
          {errors.maxInstalments && (
            <p id="maxInstalments-error" className="text-xs text-red-600 font-medium">
              {errors.maxInstalments.message}
            </p>
          )}
        </div>

        {/* 3. Auto-approve Max Amount */}
        <div className="space-y-1">
          <label htmlFor="autoApproveDollars" className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Auto-Approve Threshold ($ USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-sm text-muted">$</span>
            <input
              id="autoApproveDollars"
              type="text"
              data-testid={TEST_IDS.policyAutoApproveAmount}
              {...register('autoApproveDollars')}
              aria-describedby={errors.autoApproveDollars ? 'autoApproveDollars-error' : undefined}
              placeholder="500.00"
              className={`w-full pl-7 pr-3 py-2 border rounded text-sm tabular focus:outline-none focus:ring-2 focus:ring-accent ${
                errors.autoApproveDollars ? 'border-red-500' : 'border-border'
              }`}
            />
          </div>
          {errors.autoApproveDollars && (
            <p id="autoApproveDollars-error" className="text-xs text-red-600 font-medium">
              {errors.autoApproveDollars.message}
            </p>
          )}
          <p className="text-[11px] text-muted">Actions involving amounts up to this limit can execute without human review.</p>
        </div>

        {/* 4. Required Human Review Checkboxes */}
        <div className="space-y-2 pt-2 border-t border-border">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Actions Requiring Human Review
          </label>
          <Controller
            name="requireApprovalFor"
            control={control}
            render={({ field }) => {
              const options: { value: 'OFFER_DISCOUNT' | 'OFFER_INSTALMENTS' | 'ESCALATE'; label: string; testId: string }[] = [
                { value: 'OFFER_DISCOUNT', label: 'Offer Early Settlement Discount', testId: TEST_IDS.policyRequireDiscount },
                { value: 'OFFER_INSTALMENTS', label: 'Offer Split Instalments', testId: TEST_IDS.policyRequireInstalments },
                { value: 'ESCALATE', label: 'Formal Escalation Notices', testId: TEST_IDS.policyRequireEscalate },
              ];

              return (
                <div className="space-y-2">
                  {options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        data-testid={opt.testId}
                        checked={field.value?.includes(opt.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            field.onChange([...(field.value || []), opt.value]);
                          } else {
                            field.onChange(field.value.filter((v) => v !== opt.value));
                          }
                        }}
                        className="rounded border-border text-accent focus:ring-accent"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              );
            }}
          />
        </div>

        {/* 5. Quiet Hours */}
        <div className="space-y-2 pt-2 border-t border-border">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Quiet Hours (UTC 0..23)
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="quietHoursStart" className="text-xs text-muted">Start Hour</label>
              <input
                id="quietHoursStart"
                type="number"
                data-testid={TEST_IDS.policyQuietStart}
                {...register('quietHoursStart')}
                aria-describedby={errors.quietHoursStart ? 'quietHoursStart-error' : undefined}
                className={`w-full px-3 py-2 border rounded text-sm tabular focus:outline-none focus:ring-2 focus:ring-accent ${
                  errors.quietHoursStart ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.quietHoursStart && (
                <p id="quietHoursStart-error" className="text-xs text-red-600 font-medium">
                  {errors.quietHoursStart.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="quietHoursEnd" className="text-xs text-muted">End Hour</label>
              <input
                id="quietHoursEnd"
                type="number"
                data-testid={TEST_IDS.policyQuietEnd}
                {...register('quietHoursEnd')}
                aria-describedby={errors.quietHoursEnd ? 'quietHoursEnd-error' : undefined}
                className={`w-full px-3 py-2 border rounded text-sm tabular focus:outline-none focus:ring-2 focus:ring-accent ${
                  errors.quietHoursEnd ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.quietHoursEnd && (
                <p id="quietHoursEnd-error" className="text-xs text-red-600 font-medium">
                  {errors.quietHoursEnd.message}
                </p>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted">The agent will not dispatch notices or settle invoices during quiet hours.</p>
        </div>

        {/* 6. Max Reminders Per Invoice Per Week */}
        <div className="space-y-1 pt-2 border-t border-border">
          <label htmlFor="maxRemindersPerInvoicePerWeek" className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Maximum Reminders Per Invoice Per Week (0..14)
          </label>
          <input
            id="maxRemindersPerInvoicePerWeek"
            type="number"
            data-testid={TEST_IDS.policyMaxReminders}
            {...register('maxRemindersPerInvoicePerWeek')}
            aria-describedby={errors.maxRemindersPerInvoicePerWeek ? 'maxRemindersPerInvoicePerWeek-error' : undefined}
            className={`w-full px-3 py-2 border rounded text-sm tabular focus:outline-none focus:ring-2 focus:ring-accent ${
              errors.maxRemindersPerInvoicePerWeek ? 'border-red-500' : 'border-border'
            }`}
          />
          {errors.maxRemindersPerInvoicePerWeek && (
            <p id="maxRemindersPerInvoicePerWeek-error" className="text-xs text-red-600 font-medium">
              {errors.maxRemindersPerInvoicePerWeek.message}
            </p>
          )}
        </div>

        {/* Submit Button: Disabled until dirty and valid */}
        <div className="pt-4 border-t border-border flex items-center justify-end">
          <button
            type="submit"
            data-testid={TEST_IDS.policySave}
            disabled={!isDirty || !isValid || isSubmitting}
            className="px-4 py-2 rounded text-sm font-semibold bg-accent text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Saving...' : 'Save Policy'}
          </button>
        </div>
      </form>
    </div>
  );
};
