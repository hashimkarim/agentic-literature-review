import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import "./select.css";

export type SelectOption = { value: string; label: string; disabled?: boolean; detail?: string | undefined };

export function Select({ id, label, value, options, onChange, disabled = false, placeholder = "Select an option", compact = false }: {
  id?: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  const selected = options.find((option) => option.value === value);
  // Radix reserves the empty string for placeholders; CLI default is a real option.
  const encode = (input: string) => `option:${input}`;
  return <Primitive.Root value={encode(value)} onValueChange={(next) => onChange(next.slice(7))} disabled={disabled || options.length === 0}>
    <Primitive.Trigger id={id} aria-label={label} className={`la-dropdown-trigger${compact ? " compact" : ""}`} title={selected?.label ?? placeholder}>
      <span className="la-dropdown-value"><Primitive.Value>{selected?.label ?? placeholder}</Primitive.Value></span>
      <Primitive.Icon asChild><ChevronDown size={14} aria-hidden="true" /></Primitive.Icon>
    </Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Content className="la-dropdown-menu" position="popper" sideOffset={6} collisionPadding={12} aria-label={label}>
        <Primitive.ScrollUpButton className="la-dropdown-scroll"><ChevronUp size={14} aria-hidden="true" /></Primitive.ScrollUpButton>
        <Primitive.Viewport className="la-dropdown-viewport">
          <Primitive.Group>
            <Primitive.Label className="la-dropdown-label">{label}</Primitive.Label>
            {options.map((option) => <Primitive.Item className="la-dropdown-option" key={option.value} value={encode(option.value)} disabled={option.disabled ?? false} textValue={option.label}>
              <Primitive.ItemIndicator className="la-dropdown-indicator"><Check size={14} aria-hidden="true" /></Primitive.ItemIndicator>
              <Primitive.ItemText>{option.label}</Primitive.ItemText>
              {option.detail && <span className="la-dropdown-detail">{option.detail}</span>}
            </Primitive.Item>)}
          </Primitive.Group>
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="la-dropdown-scroll"><ChevronDown size={14} aria-hidden="true" /></Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
