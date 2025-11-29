import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';

/**
 * ABC notation editor that reads/writes to the Zustand store.
 * Uses local state + debouncing to avoid re-renders on every keystroke.
 */
export const AbcEditor = () => {
  const notation = useAppStore((state) => state.notation);
  const setNotation = useAppStore((state) => state.setNotation);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState(notation);
  const timeoutRef = useRef<number | undefined>(undefined);

  // Update local value if store value changes externally
  useEffect(() => {
    setLocalValue(notation);
  }, [notation]);

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

    // Debounce the setNotation to avoid too many re-renders
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setNotation(newValue);
    }, 300); // Update store after 300ms of no typing
  };

  return (
    <div className="abc-editor">
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
