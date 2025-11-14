import { useEffect, useRef, useState } from 'react';

interface AbcEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export const AbcEditor = ({ value, onChange }: AbcEditorProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<number | undefined>(undefined);

  // Update local value if parent value changes externally
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (textareaRef.current) {
      // Auto-resize textarea
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [localValue]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    // Debounce the onChange callback to avoid too many re-renders
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      onChange(newValue);
    }, 300); // Update preview after 300ms of no typing
  };

  return (
    <div className="abc-editor">
      <div className="abc-editor-header">
        <h3>ABC Notation Editor</h3>
      </div>
      <textarea
        ref={textareaRef}
        className="abc-editor-textarea"
        value={localValue}
        onChange={handleChange}
        placeholder="Enter ABC notation here..."
        spellCheck={false}
      />
    </div>
  );
};
