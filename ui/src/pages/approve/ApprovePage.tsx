import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { DynamicField, type FormField } from './DynamicField';
import { ContextPanel } from './ContextPanel';

type PageState = 'loading' | 'form' | 'already_handled' | 'submitted' | 'error';

interface FormSchema {
  title?: string;
  description?: string;
  fields?: FormField[];
  context?: Record<string, unknown>;
}

export function ApprovePage() {
  const { executionId, stepKey } = useParams<{
    executionId: string;
    stepKey: string;
  }>();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [executionStatus, setExecutionStatus] = useState<string>('');
  const [form, setForm] = useState<FormSchema | null>(null);
  const [rawData, setRawData] = useState<Record<string, unknown> | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [freeText, setFreeText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!executionId || !stepKey) return;

    const fetchApproval = async () => {
      try {
        const data = await api.getApproval(executionId, stepKey);

        if (data.status !== 'waiting') {
          setExecutionStatus(data.status);
          setPageState('already_handled');
          return;
        }

        if (data.data?._form) {
          const formSchema = data.data._form as FormSchema;
          setForm(formSchema);

          // Initialize form values with defaults
          const defaults: Record<string, unknown> = {};
          for (const field of formSchema.fields || []) {
            if (field.default !== undefined) {
              defaults[field.name] = field.default;
            } else if (field.type === 'boolean') {
              defaults[field.name] = false;
            } else {
              defaults[field.name] = '';
            }
          }
          setFormValues(defaults);
          setPageState('form');
        } else if (data.data) {
          setRawData(data.data as Record<string, unknown>);
          setPageState('form');
        } else {
          setPageState('form');
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load approval'
        );
        setPageState('error');
      }
    };

    fetchApproval();
  }, [executionId, stepKey]);

  const handleFieldChange = (name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (!executionId || !stepKey) return;
    setSubmitting(true);
    try {
      const data = form?.fields ? formValues : { response: freeText };
      await api.submitApproval(executionId, stepKey, data);
      setPageState('submitted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-xs text-gray-400">Powered by</p>
          <div className="flex items-center gap-2">
            <img src="/polos-logo.png" alt="Polos" className="h-8 w-auto" />
            <span className="text-xl font-semibold text-gray-900">Polos</span>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            {pageState === 'loading' && <LoadingState />}
            {pageState === 'error' && <ErrorState message={error} />}
            {pageState === 'already_handled' && (
              <AlreadyHandledState status={executionStatus} />
            )}
            {pageState === 'submitted' && <SubmittedState />}
            {pageState === 'form' && (
              <FormState
                form={form}
                rawData={rawData}
                formValues={formValues}
                freeText={freeText}
                error={error}
                submitting={submitting}
                onFieldChange={handleFieldChange}
                onFreeTextChange={setFreeText}
                onSubmit={handleSubmit}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4" />
      <p className="text-sm text-gray-500">Loading approval...</p>
    </div>
  );
}

function ErrorState({ message }: { message: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <AlertTriangle className="h-10 w-10 text-red-400 mb-3" />
      <p className="text-sm font-medium text-gray-900">
        Failed to load approval
      </p>
      <p className="text-sm text-gray-500 mt-1">
        {message || 'An unknown error occurred'}
      </p>
    </div>
  );
}

function AlreadyHandledState({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <CheckCircle2 className="h-10 w-10 text-gray-400 mb-3" />
      <p className="text-sm font-medium text-gray-900">Already handled</p>
      <p className="text-sm text-gray-500 mt-1">
        This execution is no longer waiting for approval.
      </p>
      <Badge variant="secondary" className="mt-3">
        {status}
      </Badge>
    </div>
  );
}

function SubmittedState() {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <CheckCircle2 className="h-10 w-10 text-green-500 mb-3" />
      <p className="text-sm font-medium text-gray-900">Response submitted</p>
      <p className="text-sm text-gray-500 mt-1">
        The workflow will now resume.
      </p>
    </div>
  );
}

interface FormStateProps {
  form: FormSchema | null;
  rawData: Record<string, unknown> | null;
  formValues: Record<string, unknown>;
  freeText: string;
  error: string | null;
  submitting: boolean;
  onFieldChange: (name: string, value: unknown) => void;
  onFreeTextChange: (value: string) => void;
  onSubmit: () => void;
}

function FormState({
  form,
  rawData,
  formValues,
  freeText,
  error,
  submitting,
  onFieldChange,
  onFreeTextChange,
  onSubmit,
}: FormStateProps) {
  const hasFormFields = form?.fields && form.fields.length > 0;

  return (
    <div className="space-y-5">
      {/* Title and badge */}
      <div className="flex items-start justify-between gap-3">
        <div>
          {form?.title && (
            <h2 className="text-lg font-semibold text-gray-900">
              {form.title}
            </h2>
          )}
          {form?.description && (
            <p className="text-sm text-gray-500 mt-1">{form.description}</p>
          )}
          {!form?.title && !rawData && (
            <h2 className="text-lg font-semibold text-gray-900">
              Approval Required
            </h2>
          )}
        </div>
        <Badge className="shrink-0 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Waiting
        </Badge>
      </div>

      {/* Context panel */}
      {form?.context && Object.keys(form.context).length > 0 && (
        <ContextPanel context={form.context} />
      )}

      {/* Dynamic form fields */}
      {hasFormFields && (
        <div className="space-y-4">
          {form!.fields!.map((field) => (
            <DynamicField
              key={field.name}
              field={field}
              value={formValues[field.name]}
              onChange={onFieldChange}
            />
          ))}
        </div>
      )}

      {/* Raw data + free text when no form schema */}
      {!hasFormFields && rawData && (
        <div className="space-y-3">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all">
              {JSON.stringify(rawData, null, 2)}
            </pre>
          </div>
          <div className="space-y-1.5">
            <Label>Response</Label>
            <Textarea
              value={freeText}
              onChange={(e) => onFreeTextChange(e.target.value)}
              placeholder="Enter your response..."
            />
          </div>
        </div>
      )}

      {/* No form and no raw data — just free text */}
      {!hasFormFields && !rawData && (
        <div className="space-y-1.5">
          <Label>Response</Label>
          <Textarea
            value={freeText}
            onChange={(e) => onFreeTextChange(e.target.value)}
            placeholder="Enter your response..."
          />
        </div>
      )}

      {/* Error message */}
      {error && <div className="text-sm text-red-600 text-center">{error}</div>}

      {/* Actions */}
      <div className="flex justify-end pt-2">
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}
