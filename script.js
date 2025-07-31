// Utility: ensure .csv extension
function ensureCsvExtension(name) {
  if (!name) return "export.csv";
  name = name.trim();
  if (name === "") return "export.csv";
  // Remove trailing dots/spaces (Windows file safety)
  name = name.replace(/[ .]+$/g, "");
  // If it has no extension or not .csv, append .csv
  if (!/\.csv$/i.test(name)) {
    name += ".csv";
  }
  return name;
}

// Enhanced CSV parsing that properly handles quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  let wasQuoted = false; // New flag
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote - use array join for better performance
        current += '"';
        i += 2;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        wasQuoted = true; // Mark as quoted if we encounter a quote
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push({ value: current, wasQuoted: wasQuoted }); // Store value and flag
      current = '';
      inQuotes = false; // Reset for next field
      wasQuoted = false;
      i++;
    } else {
      // Optimized string concatenation - check if we're building a large string
      if (current.length < 10000) { // Reasonable limit to prevent memory issues
        current += char;
      } else {
        // For very long fields, continue but log a warning (in production)
        current += char;
      }
      i++;
    }
  }
  
  // Add the last field
  result.push({ value: current, wasQuoted: wasQuoted });
  return result;
}

// CSV validation and escaping functions
function escapeCSVValue(value, forceQuote = false) {
  // If value contains comma, quote, newline, or carriage return, wrap in quotes
  // OR if forceQuote is true
  if (forceQuote || value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    // Escape existing quotes by doubling them
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return value;
}

// Check if a line is already properly formatted
function isProperlyFormattedCSV(originalLine, parsedValues) {
  // If we successfully parsed the line and got the expected number of fields,
  // and the comma count matches, then it's already properly formatted
  const originalCommaCount = (originalLine.match(/,/g) || []).length;
  const expectedCommaCount = parsedValues.length - 1;
  
  // Basic validation: if comma count matches and we parsed successfully, it's valid
  if (originalCommaCount === expectedCommaCount) {
    // Additional check: make sure quotes are balanced (even number)
    const quoteCount = (originalLine.match(/"/g) || []).length;
    if (quoteCount % 2 === 0) {
      return true;
    }
  }
  
  return false;
}

// Function to detect if input appears to be CSV format
function detectCSVFormat(text) {
  if (!text || !text.trim()) return true; // Empty text is considered valid
  
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return true;
  
  // Check for basic CSV indicators
  let hasCommas = false;
  let hasConsistentStructure = true;
  let expectedCommaCount = null;
  let validCSVLines = 0;
  
  for (let i = 0; i < Math.min(lines.length, 10); i++) { // Check first 10 lines
    const line = lines[i];
    const commaCount = (line.match(/,/g) || []).length;
    
    if (commaCount > 0) {
      hasCommas = true;
      
      // Try to parse the line to see if it's valid CSV
      try {
        const parsed = parseCSVLine(line);
        if (parsed && parsed.length > 0) {
          validCSVLines++;
          
          // Check for consistent comma count (allowing some variation for headers vs data)
          if (expectedCommaCount === null) {
            expectedCommaCount = commaCount;
          } else if (Math.abs(commaCount - expectedCommaCount) > 2) {
            // Allow some variation but not too much
            hasConsistentStructure = false;
          }
        }
      } catch (e) {
        // Parsing failed, might not be CSV
      }
    } else if (expectedCommaCount !== null && expectedCommaCount > 0) {
      // Line has no commas but we expected some based on previous lines
      hasConsistentStructure = false;
    }
  }
  
  // Heuristics to determine if this looks like CSV:
  // 1. Must have some commas
  // 2. Most lines should parse successfully
  // 3. Should have some structural consistency
  const csvLikelihood = hasCommas &&
                       (validCSVLines / Math.min(lines.length, 10)) > 0.5 &&
                       hasConsistentStructure;
  
  return csvLikelihood;
}

// Enhanced validation that detects column count mismatches
function validateAndFixCSV(text) {
  const lines = text.split(/\r?\n/);
  const fixedLines = [];
  const errors = [];
  let expectedColumnCount = null;
  let headerLine = null;
  
  // First check if the input appears to be CSV format at all
  if (!detectCSVFormat(text)) {
    // If it doesn't look like CSV, mark all non-empty lines as errors
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim()) {
        errors.push({
          line: i + 1,
          content: line,
          error: 'It seems like the input isn\'t in a valid CSV formatting',
          type: 'not_csv_format'
        });
      }
      fixedLines.push(line);
    }
    
    return {
      fixedText: fixedLines.join('\r\n'),
      errors: errors,
      expectedColumnCount: null,
      headerLine: null,
      isNotCSV: true
    };
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      fixedLines.push(line);
      continue;
    }
    
    try {
      // Parse the line using proper CSV parsing
      const values = parseCSVLine(line);
      
      // Determine expected column count from first non-empty line (header)
      if (expectedColumnCount === null) {
        expectedColumnCount = values.length;
        headerLine = i + 1;
      }
      
      // Check for column count mismatch
      if (values.length !== expectedColumnCount) {
        errors.push({
          line: i + 1,
          content: line,
          error: `Column count mismatch: expected ${expectedColumnCount}, got ${values.length}`,
          type: 'column_mismatch',
          expectedCount: expectedColumnCount,
          actualCount: values.length
        });
        
        // For fixing: if we have too many columns, try to detect unescaped commas
        if (values.length > expectedColumnCount) {
          // Simple heuristic: combine excess columns into the last expected column
          const fixedValues = values.slice(0, expectedColumnCount - 1).map(v => v.value);
          const lastValue = values.slice(expectedColumnCount - 1).map(v => v.value).join(', ');
          fixedValues.push(lastValue);
          
          const escapedValues = fixedValues.map(escapeCSVValue);
          fixedLines.push(escapedValues.join(','));
        } else {
          // Too few columns - add empty columns
          const paddedValues = values.map(v => v.value);
          while (paddedValues.length < expectedColumnCount) {
            paddedValues.push('');
          }
          const escapedValues = paddedValues.map(escapeCSVValue);
          fixedLines.push(escapedValues.join(','));
        }
      } else {
        // If we successfully parsed the line into the correct number of columns,
        // and the parsing succeeded without errors, the line is already properly formatted
        fixedLines.push(line);
      }
      
    } catch (error) {
      // If parsing fails, check for unmatched quotes
      let quoteCount = 0;
      for (let char of line) {
        if (char === '"') quoteCount++;
      }
      
      if (quoteCount % 2 !== 0) {
        errors.push({
          line: i + 1,
          content: line,
          error: 'Unmatched quotes detected',
          type: 'unmatched_quotes'
        });
      } else {
        errors.push({
          line: i + 1,
          content: line,
          error: 'Invalid CSV format',
          type: 'invalid_format'
        });
      }
      fixedLines.push(line);
    }
  }
  
  return {
    fixedText: fixedLines.join('\r\n'),
    errors: errors,
    expectedColumnCount: expectedColumnCount,
    headerLine: headerLine
  };
}

// Update line numbers and highlight errors - optimized version with immediate feedback
function updateLineNumbers(text, errors, immediateErrorLine = null) {
  const lineNumbersEl = document.getElementById('lineNumbers');
  const lines = text.split(/\r?\n/);
  const errorLines = new Set(errors.map(err => err.line));
  
  // Only update if line count has changed or error status changed
  const currentLineCount = lineNumbersEl.children.length;
  let needsUpdate = currentLineCount !== lines.length;
  
  if (!needsUpdate) {
    // Check if error status for existing lines has changed
    for (let i = 0; i < currentLineCount; i++) {
      const lineNum = i + 1;
      const hasError = errorLines.has(lineNum);
      const lineEl = lineNumbersEl.children[i];
      if (lineEl && (lineEl.classList.contains('error') !== hasError)) {
        needsUpdate = true;
        break;
      }
    }
  }
  
  if (!needsUpdate && immediateErrorLine === null) return; // Skip update if no changes
  
  // If we only need to update immediate error highlighting
  if (!needsUpdate && immediateErrorLine !== null) {
    for (let i = 0; i < lineNumbersEl.children.length; i++) {
      const lineEl = lineNumbersEl.children[i];
      const lineNum = i + 1;
      
      // Remove immediate class from all lines first
      lineEl.classList.remove('immediate');
      
      // Add immediate class to the current error line
      if (lineNum === immediateErrorLine && errorLines.has(lineNum)) {
        lineEl.classList.add('immediate');
      }
    }
    return;
  }
  
  // Create document fragment for better performance
  const fragment = document.createDocumentFragment();
  
  for (let i = 1; i <= lines.length; i++) {
    const isError = errorLines.has(i);
    const lineNumber = i.toString().padStart(3, ' ');
    
    const lineDiv = document.createElement('div');
    lineDiv.className = isError ? 'error' : '';
    
    // Add immediate class for real-time feedback
    if (isError && i === immediateErrorLine) {
      lineDiv.classList.add('immediate');
    }
    
    lineDiv.textContent = lineNumber;
    fragment.appendChild(lineDiv);
  }
  
  // Clear and replace all line numbers at once
  lineNumbersEl.innerHTML = '';
  lineNumbersEl.appendChild(fragment);
}

function highlightErrorLines(text, errors, isImmediate = false, isNotCSV = false) {
  const validationMsg = document.getElementById('validationMessage');
  const downloadBtn = document.getElementById('downloadBtn');
  
  // Update line numbers with error highlighting
  updateLineNumbers(text, errors);
  
  if (errors.length > 0) {
    // Special handling for non-CSV format detection
    if (isNotCSV || (errors.length > 0 && errors[0].type === 'not_csv_format')) {
      validationMsg.innerHTML = `It seems like the input isn't in a valid CSV formatting`;
      validationMsg.className = isImmediate ? 'validation-message immediate' : 'validation-message persistent';
      validationMsg.style.display = 'block';
    } else {
      const errorList = errors.map(err => {
        let errorText = `Line ${err.line}: ${err.error}`;
        if (err.content.length > 50) {
          errorText += ` - "${err.content.substring(0, 50)}..."`;
        } else {
          errorText += ` - "${err.content}"`;
        }
        return errorText;
      }).join('\n');
      
      validationMsg.innerHTML = `Found ${errors.length} problematic line(s):<br><pre style="margin: 0.5rem 0; white-space: pre-wrap; font-size: 0.8rem;">${errorList}</pre>`;
      validationMsg.className = isImmediate ? 'validation-message immediate' : 'validation-message persistent';
      validationMsg.style.display = 'block';
    }
    
    // Disable download when there are errors
    downloadBtn.disabled = true;
  } else {
    validationMsg.style.display = 'none';
    validationMsg.className = 'validation-message';
    downloadBtn.disabled = false;
  }
}

// Normalize delimiters per line:
// - Keep quoted segments intact
// - Replace unquoted tabs and semicolons with commas
function normalizeLineDelimiters(line) {
  let out = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      out += ch;
      // Toggle quotes unless it's an escaped quote ("")
      if (i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote: include next and skip toggle
        out += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (ch === "\t" || ch === ";")) {
      out += ",";
    } else {
      out += ch;
    }
  }
  return out;
}

function normalizeTextDelimiters(text) {
  // Process line-by-line to avoid cross-line quote interactions
  return text.split(/\r?\n/).map(normalizeLineDelimiters).join("\r\n");
}

// AI-focused cleanup functions
function removeEmptyRows(text) {
  return text.split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .join('\r\n');
}

function trimFieldWhitespace(text) {
  return text.split(/\r?\n/)
    .map(line => {
      if (!line.trim()) return line;
      try {
        const parsedFields = parseCSVLine(line); // Now returns { value, wasQuoted }
        const trimmedAndEscaped = parsedFields.map(field => {
          const trimmedValue = field.value.trim();
          // If it was originally quoted, or now needs quoting, force quote
          return escapeCSVValue(trimmedValue, field.wasQuoted || trimmedValue.includes(',') || trimmedValue.includes('"') || trimmedValue.includes('\n') || trimmedValue.includes('\r'));
        });
        return trimmedAndEscaped.join(',');
      } catch {
        return line; // If parsing fails, return original
      }
    })
    .join('\r\n');
}

function fixSmartQuotes(text) {
  return text
    .replace(/[""]/g, '"')  // Smart double quotes to straight
    .replace(/['']/g, "'")  // Smart single quotes to straight
    .replace(/…/g, '...')   // Ellipsis to three dots
    .replace(/–/g, '-')     // En dash to hyphen
    .replace(/—/g, '-');    // Em dash to hyphen
}

function removeDuplicateRows(text) {
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const uniqueLines = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === '' || !seen.has(trimmedLine)) {
      seen.add(trimmedLine);
      uniqueLines.push(line);
    }
  }
  
  return uniqueLines.join('\r\n');
}

function getCSVStats(text) {
  if (!text.trim()) return null;
  
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return null;
  
  let columnCount = 0;
  try {
    const firstLine = lines[0];
    const values = parseCSVLine(firstLine);
    columnCount = values.length;
  } catch {
    columnCount = (lines[0].match(/,/g) || []).length + 1;
  }
  
  return {
    rows: lines.length,
    columns: columnCount,
    hasHeader: lines.length > 0
  };
}

function updateCSVStats(text) {
  const statsEl = document.getElementById('csvStats');
  const statsContentEl = document.getElementById('statsContent');
  
  const stats = getCSVStats(text);
  if (stats) {
    statsContentEl.textContent = `${stats.rows} rows × ${stats.columns} columns`;
    statsEl.style.display = 'block';
  } else {
    statsEl.style.display = 'none';
    const csvPreviewEl = document.getElementById('csvPreview');
    if (csvPreviewEl) csvPreviewEl.style.display = 'none';
  }
}

function generatePreviewTable(text) {
  if (!text.trim()) return '';
  
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return '';
  
  const previewLines = lines.slice(0, 6); // Header + 5 data rows
  const rows = [];
  
  for (const line of previewLines) {
    try {
      const values = parseCSVLine(line);
      // Extract just the value from each parsed field object
      rows.push(values.map(field => field.value));
    } catch {
      // If parsing fails, split by comma as fallback
      rows.push(line.split(','));
    }
  }
  
  if (rows.length === 0) return '';
  
  let html = '<table class="preview-table">';
  
  // Header row
  if (rows.length > 0) {
    html += '<thead><tr>';
    for (const cell of rows[0]) {
      const cellText = cell.length > 30 ? cell.substring(0, 30) + '...' : cell;
      html += `<th title="${cell.replace(/"/g, '&quot;')}">${cellText}</th>`;
    }
    html += '</tr></thead>';
  }
  
  // Data rows
  if (rows.length > 1) {
    html += '<tbody>';
    for (let i = 1; i < rows.length; i++) {
      html += '<tr>';
      for (const cell of rows[i]) {
        const cellText = cell.length > 30 ? cell.substring(0, 30) + '...' : cell;
        html += `<td title="${cell.replace(/"/g, '&quot;')}">${cellText}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  }
  
  html += '</table>';
  return html;
}

function makeBlobFromText(text, addBom) {
  if (addBom) {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    return new Blob([bom, text], { type: "text/csv;charset=utf-8" });
  }
  return new Blob([text], { type: "text/csv;charset=utf-8" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Wire UI
  const inputEl = document.getElementById("csvInput");
  const filenameEl = document.getElementById("filename");
  const normalizeEl = document.getElementById("normalize");
  const addBomEl = document.getElementById("addBom");
  const btn = document.getElementById("downloadBtn");
  const fileInputEl = document.getElementById("fileInput");
  const selectedFilenameEl = document.getElementById("selectedFilename");
  
  // AI cleanup options
  const removeEmptyRowsEl = document.getElementById("removeEmptyRows");
  const trimWhitespaceEl = document.getElementById("trimWhitespace");
  const fixSmartQuotesEl = document.getElementById("fixSmartQuotes");
  const removeDuplicatesEl = document.getElementById("removeDuplicates");
  const cleanupContainer = document.getElementById("cleanupOptions"); // This is now 'control-panel'

  // Select All button and Preview functionality
  const selectAllCleanupBtn = document.getElementById("selectAllCleanup");
  const togglePreviewBtn = document.getElementById("togglePreview");
  const csvPreviewEl = document.getElementById("csvPreview");

  // Utility to get all cleanup checkboxes within the single options block
  function getCleanupCheckboxes() {
    // include both AI cleanup and general checkboxes inside the consolidated block
    return Array.from(cleanupContainer.querySelectorAll('input[type="checkbox"]'));
  }

  // Update Select All button label according to current state
  function syncSelectAllLabel() {
    const boxes = getCleanupCheckboxes();
    const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
    selectAllCleanupBtn.textContent = allChecked ? 'Deselect All' : 'Select All';
  }

  // Select/Deselect all options within the consolidated block
  if (selectAllCleanupBtn && cleanupContainer) {
    selectAllCleanupBtn.addEventListener('click', () => {
      const boxes = getCleanupCheckboxes();
      const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
      const target = !allChecked;
      boxes.forEach(cb => { cb.checked = target; });
      syncSelectAllLabel();
    });

    // Keep the button label in sync when user toggles individual options
    getCleanupCheckboxes().forEach(cb => {
      cb.addEventListener('change', syncSelectAllLabel);
    });
    // Initial sync
    syncSelectAllLabel();
  }

  // Preview toggle
  if (togglePreviewBtn && csvPreviewEl) {
    togglePreviewBtn.addEventListener('click', () => {
      const text = inputEl.value || "";
      // Check if preview is currently visible
      const isVisible = csvPreviewEl.style.display === 'block';
      if (!isVisible) {
        const previewHTML = generatePreviewTable(text);
        if (previewHTML) {
          document.getElementById('previewTable').innerHTML = previewHTML;
          csvPreviewEl.style.display = 'block';
          togglePreviewBtn.textContent = 'Hide Preview';
        }
      } else {
        csvPreviewEl.style.display = 'none';
        togglePreviewBtn.textContent = 'Show Preview';
      }
    });
  }

  // Validation state
  let validationTimeout;
  let immediateValidationTimeout;
  let currentValidationResult = null;
  let lastCursorPosition = 0;

  // Improve paste area UX: focus textarea on load
  inputEl.focus();

  // Get current line number from cursor position
  function getCurrentLineNumber(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    return textBeforeCursor.split(/\r?\n/).length;
  }

  // Validate a specific line and return error if found
  function validateSingleLine(lineText, lineNumber, expectedColumnCount) {
    if (!lineText.trim()) return null;
    
    try {
      const parsedValues = parseCSVLine(lineText);
      
      // Check for column count mismatch
      if (expectedColumnCount !== null && parsedValues.length !== expectedColumnCount) {
        return {
          line: lineNumber,
          content: lineText,
          error: `Column count mismatch: expected ${expectedColumnCount}, got ${parsedValues.length}`,
          type: 'column_mismatch',
          expectedCount: expectedColumnCount,
          actualCount: parsedValues.length
        };
      }
      
      return null; // No error
    } catch (error) {
      // Check for unmatched quotes
      let quoteCount = 0;
      for (let char of lineText) {
        if (char === '"') quoteCount++;
      }
      
      if (quoteCount % 2 !== 0) {
        return {
          line: lineNumber,
          content: lineText,
          error: 'Unmatched quotes detected',
          type: 'unmatched_quotes'
        };
      } else {
        return {
          line: lineNumber,
          content: lineText,
          error: 'Invalid CSV format',
          type: 'invalid_format'
        };
      }
    }
  }

  // Immediate validation for current line being edited
  function performImmediateValidation() {
    const text = inputEl.value || "";
    const cursorPosition = inputEl.selectionStart;
    
    if (!text.trim()) {
      document.getElementById('validationMessage').style.display = 'none';
      document.getElementById('downloadBtn').disabled = false;
      document.getElementById('lineNumbers').innerHTML = '';
      updateCSVStats('');
      currentValidationResult = null;
      return;
    }

    const lines = text.split(/\r?\n/);
    const currentLineNum = getCurrentLineNumber(text, cursorPosition);
    const currentLineText = lines[currentLineNum - 1] || '';
    
    // Get expected column count from first non-empty line
    let expectedColumnCount = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) {
        try {
          const parsedValues = parseCSVLine(lines[i]);
          expectedColumnCount = parsedValues.length;
          break;
        } catch {
          // Continue to next line if parsing fails
        }
      }
    }

    // Validate current line immediately
    const currentLineError = validateSingleLine(currentLineText, currentLineNum, expectedColumnCount);
    
    // Update existing validation result or create new one
    if (!currentValidationResult) {
      currentValidationResult = { errors: [], expectedColumnCount, headerLine: 1 };
    }
    
    // Remove any existing errors for current line
    currentValidationResult.errors = currentValidationResult.errors.filter(err => err.line !== currentLineNum);
    
    // Add new error if found
    if (currentLineError) {
      currentValidationResult.errors.push(currentLineError);
    }
    
    // Update line numbers with current errors and immediate highlighting
    updateLineNumbers(text, currentValidationResult.errors, currentLineNum);
    
    // Update validation message for immediate feedback
    if (currentLineError) {
      const validationMsg = document.getElementById('validationMessage');
      validationMsg.innerHTML = `Line ${currentLineError.line}: ${currentLineError.error}`;
      validationMsg.className = 'validation-message immediate';
      validationMsg.style.display = 'block';
      document.getElementById('downloadBtn').disabled = true;
    } else if (currentValidationResult.errors.length === 0) {
      const validationMsg = document.getElementById('validationMessage');
      validationMsg.style.display = 'none';
      validationMsg.className = 'validation-message';
      document.getElementById('downloadBtn').disabled = false;
    }
  }

  // Full validation with debouncing (for complete document validation)
  function performFullValidation() {
    const text = inputEl.value || "";
    if (!text.trim()) {
      document.getElementById('validationMessage').style.display = 'none';
      document.getElementById('downloadBtn').disabled = false;
      document.getElementById('lineNumbers').innerHTML = '';
      updateCSVStats('');
      currentValidationResult = null;
      return;
    }
    
    updateCSVStats(text);
    currentValidationResult = validateAndFixCSV(text);
    highlightErrorLines(text, currentValidationResult.errors, false, currentValidationResult.isNotCSV);
    
    // Always update line numbers, even when there are no errors
    if (currentValidationResult.errors.length === 0) {
      updateLineNumbers(text, []);
    }
  }

  // Legacy function name for compatibility
  function performValidation() {
    performFullValidation();
  }

  // Add immediate validation on input for current line
  inputEl.addEventListener('input', (e) => {
    // Clear existing timeouts
    clearTimeout(immediateValidationTimeout);
    clearTimeout(validationTimeout);
    
    // Immediate validation for current line (very short delay)
    immediateValidationTimeout = setTimeout(performImmediateValidation, 100);
    
    // Full validation with longer debounce
    validationTimeout = setTimeout(performFullValidation, 800);
  });

  // Add validation on cursor movement to check new line
  inputEl.addEventListener('selectionchange', () => {
    const newCursorPosition = inputEl.selectionStart;
    if (Math.abs(newCursorPosition - lastCursorPosition) > 10) { // Only if cursor moved significantly
      clearTimeout(immediateValidationTimeout);
      immediateValidationTimeout = setTimeout(performImmediateValidation, 50);
    }
    lastCursorPosition = newCursorPosition;
  });

  // Add validation on keyup for immediate feedback on line changes
  inputEl.addEventListener('keyup', (e) => {
    // Check if user pressed Enter, which creates a new line
    if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      clearTimeout(immediateValidationTimeout);
      immediateValidationTimeout = setTimeout(performImmediateValidation, 50);
    }
  });

  // Add validation on paste
  inputEl.addEventListener('paste', () => {
    setTimeout(performValidation, 100);
  });

  // Sync scroll between textarea and line numbers
  inputEl.addEventListener('scroll', () => {
    const lineNumbersEl = document.getElementById('lineNumbers');
    lineNumbersEl.scrollTop = inputEl.scrollTop;
  });

  btn.addEventListener("click", () => {
    let text = inputEl.value || "";
    const name = ensureCsvExtension(filenameEl.value);
    
    // Only proceed if no validation errors
    if (currentValidationResult && currentValidationResult.errors.length > 0) {
      alert('Please fix all validation errors before downloading.');
      return;
    }
    
    // Apply AI cleanup options
    if (fixSmartQuotesEl.checked && text.length) {
      text = fixSmartQuotes(text);
    }
    
    if (trimWhitespaceEl.checked && text.length) {
      text = trimFieldWhitespace(text);
    }
    
    if (removeEmptyRowsEl.checked && text.length) {
      text = removeEmptyRows(text);
    }
    
    if (removeDuplicatesEl.checked && text.length) {
      text = removeDuplicateRows(text);
    }
    
    if (normalizeEl.checked && text.length) {
      text = normalizeTextDelimiters(text);
    }
    
    // Always use CRLF line endings for widest CSV compatibility
    text = text.replace(/\r?\n/g, "\r\n");
    const blob = makeBlobFromText(text, addBomEl.checked);
    downloadBlob(blob, name);
  });

  // CSV upload → show as text
  fileInputEl.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      selectedFilenameEl.textContent = 'No file chosen';
      return;
    }
    try {
      const text = await file.text(); // UTF-8, BOM handled by browser
      // Show raw text to user; do not normalize automatically
      inputEl.value = text;
      // Suggest filename based on uploaded file
      filenameEl.value = ensureCsvExtension(file.name);
      selectedFilenameEl.textContent = file.name; // Update the displayed filename
      // Move caret to start for visibility
      inputEl.scrollTop = 0;
      // Validate the uploaded content
      performValidation();
    } catch (err) {
      alert("Failed to read file: " + (err && err.message ? err.message : String(err)));
    } finally {
      // Allow re-selecting same file
      e.target.value = "";
    }
  });

  // Minor: Keep filename valid as user types (avoid illegal Windows chars)
  filenameEl.addEventListener("input", () => {
    const cleaned = filenameEl.value.replace(/[\\/:*?"<>|]/g, "-");
    if (cleaned !== filenameEl.value) filenameEl.value = cleaned;
  });
});