// Static metadata for Salesforce formula functions, used by Formula Helper for
// autocomplete suggestions and arity validation. maxArgs: null means unbounded (variadic).
export const FORMULA_FUNCTIONS = [
  // Logical
  {name: "AND", category: "Logical", minArgs: 1, maxArgs: null, signature: "AND(logical1, logical2, ...)", description: "Returns TRUE if all arguments are TRUE."},
  {name: "OR", category: "Logical", minArgs: 1, maxArgs: null, signature: "OR(logical1, logical2, ...)", description: "Returns TRUE if any argument is TRUE."},
  {name: "NOT", category: "Logical", minArgs: 1, maxArgs: 1, signature: "NOT(logical)", description: "Reverses the logical value of its argument."},
  {name: "IF", category: "Logical", minArgs: 3, maxArgs: 3, signature: "IF(logical_test, value_if_true, value_if_false)", description: "Returns one value if a condition is true and another value if it's false."},
  {name: "CASE", category: "Logical", minArgs: 3, maxArgs: null, signature: "CASE(expression, value1, result1, value2, result2, ..., else_result)", description: "Checks a given expression against a series of values and returns the result of the first matching value."},
  {name: "ISBLANK", category: "Logical", minArgs: 1, maxArgs: 1, signature: "ISBLANK(expression)", description: "Returns TRUE if the value is empty."},
  {name: "ISNULL", category: "Logical", minArgs: 1, maxArgs: 1, signature: "ISNULL(expression)", description: "Returns TRUE if the value is null."},
  {name: "ISNUMBER", category: "Logical", minArgs: 1, maxArgs: 1, signature: "ISNUMBER(text)", description: "Returns TRUE if the text is a number."},
  {name: "ISPICKVAL", category: "Logical", minArgs: 2, maxArgs: 2, signature: "ISPICKVAL(picklist_field, text_literal)", description: "Checks if the value of a picklist field is equal to a text literal."},
  {name: "ISCHANGED", category: "Logical", minArgs: 1, maxArgs: 1, signature: "ISCHANGED(field)", description: "Compares the current record's field value to the field value that was previously saved."},
  {name: "ISNEW", category: "Logical", minArgs: 0, maxArgs: 0, signature: "ISNEW()", description: "Returns TRUE if the formula is running during the creation of a new record."},
  {name: "PRIORVALUE", category: "Logical", minArgs: 1, maxArgs: 1, signature: "PRIORVALUE(field)", description: "Returns the previous value of a field."},
  {name: "BLANKVALUE", category: "Logical", minArgs: 2, maxArgs: 2, signature: "BLANKVALUE(expression, substitute_expression)", description: "Returns a substitute expression if the given expression is blank."},
  {name: "NULLVALUE", category: "Logical", minArgs: 2, maxArgs: 2, signature: "NULLVALUE(expression, substitute_expression)", description: "Returns a substitute expression if the given expression (currency/number field) is null."},
  {name: "REGEX", category: "Logical", minArgs: 2, maxArgs: 2, signature: "REGEX(text, regex_text)", description: "Compares a text field to a regular expression and returns TRUE if there is a match."},

  // Text
  {name: "TEXT", category: "Text", minArgs: 1, maxArgs: 1, signature: "TEXT(value)", description: "Converts a value (picklist, number, date, etc.) to text."},
  {name: "VALUE", category: "Text", minArgs: 1, maxArgs: 1, signature: "VALUE(text)", description: "Converts a text value to a number."},
  {name: "LEN", category: "Text", minArgs: 1, maxArgs: 1, signature: "LEN(text)", description: "Returns the number of characters in a text string."},
  {name: "LEFT", category: "Text", minArgs: 2, maxArgs: 2, signature: "LEFT(text, num_chars)", description: "Returns the specified number of characters from the beginning of a text string."},
  {name: "RIGHT", category: "Text", minArgs: 2, maxArgs: 2, signature: "RIGHT(text, num_chars)", description: "Returns the specified number of characters from the end of a text string."},
  {name: "MID", category: "Text", minArgs: 3, maxArgs: 3, signature: "MID(text, start_num, num_chars)", description: "Returns characters from the middle of a text string."},
  {name: "FIND", category: "Text", minArgs: 2, maxArgs: 3, signature: "FIND(search_text, text, [start_num])", description: "Returns the starting position of one text string within another text string."},
  {name: "SUBSTITUTE", category: "Text", minArgs: 3, maxArgs: 3, signature: "SUBSTITUTE(text, old_text, new_text)", description: "Substitutes new text for old text in a text string."},
  {name: "TRIM", category: "Text", minArgs: 1, maxArgs: 1, signature: "TRIM(text)", description: "Removes leading and trailing spaces from a text string."},
  {name: "UPPER", category: "Text", minArgs: 1, maxArgs: 1, signature: "UPPER(text)", description: "Converts all letters in text to uppercase."},
  {name: "LOWER", category: "Text", minArgs: 1, maxArgs: 1, signature: "LOWER(text)", description: "Converts all letters in text to lowercase."},
  {name: "INITCAP", category: "Text", minArgs: 1, maxArgs: 1, signature: "INITCAP(text)", description: "Capitalizes the first letter of each word in text."},
  {name: "LPAD", category: "Text", minArgs: 2, maxArgs: 3, signature: "LPAD(text, padded_length, [pad_string])", description: "Left-pads a text string with padding characters."},
  {name: "RPAD", category: "Text", minArgs: 2, maxArgs: 3, signature: "RPAD(text, padded_length, [pad_string])", description: "Right-pads a text string with padding characters."},
  {name: "CONTAINS", category: "Text", minArgs: 2, maxArgs: 2, signature: "CONTAINS(text, compare_text)", description: "Returns TRUE if the text contains the given substring."},
  {name: "BEGINS", category: "Text", minArgs: 2, maxArgs: 2, signature: "BEGINS(text, compare_text)", description: "Returns TRUE if the text starts with the given substring."},
  {name: "REVERSE", category: "Text", minArgs: 1, maxArgs: 1, signature: "REVERSE(text)", description: "Reverses the order of characters in text."},
  {name: "SPLIT", category: "Text", minArgs: 2, maxArgs: 2, signature: "SPLIT(text, delimiter)", description: "Splits a text string into a list using a delimiter."},
  {name: "HYPERLINK", category: "Text", minArgs: 2, maxArgs: 3, signature: "HYPERLINK(url, friendly_name, [target])", description: "Creates a hyperlink."},
  {name: "GETSESSIONID", category: "Text", minArgs: 0, maxArgs: 0, signature: "GETSESSIONID()", description: "Returns the current user's session ID."},
  {name: "IMAGE", category: "Text", minArgs: 2, maxArgs: 4, signature: "IMAGE(url, alt_text, [height], [width])", description: "Displays an image at a specified URL."},

  // Math
  {name: "ABS", category: "Math", minArgs: 1, maxArgs: 1, signature: "ABS(number)", description: "Returns the absolute value of a number."},
  {name: "CEILING", category: "Math", minArgs: 1, maxArgs: 1, signature: "CEILING(number)", description: "Rounds a number up to the nearest integer."},
  {name: "FLOOR", category: "Math", minArgs: 1, maxArgs: 1, signature: "FLOOR(number)", description: "Rounds a number down to the nearest integer."},
  {name: "ROUND", category: "Math", minArgs: 2, maxArgs: 2, signature: "ROUND(number, num_digits)", description: "Rounds a number to a specified number of digits."},
  {name: "MOD", category: "Math", minArgs: 2, maxArgs: 2, signature: "MOD(number, divisor)", description: "Returns the remainder after a number is divided by a divisor."},
  {name: "SQRT", category: "Math", minArgs: 1, maxArgs: 1, signature: "SQRT(number)", description: "Returns the square root of a positive number."},
  {name: "EXP", category: "Math", minArgs: 1, maxArgs: 1, signature: "EXP(number)", description: "Returns e raised to the power of the given number."},
  {name: "LN", category: "Math", minArgs: 1, maxArgs: 1, signature: "LN(number)", description: "Returns the natural logarithm of a number."},
  {name: "LOG", category: "Math", minArgs: 1, maxArgs: 1, signature: "LOG(number)", description: "Returns the base 10 logarithm of a number."},
  {name: "MAX", category: "Math", minArgs: 1, maxArgs: null, signature: "MAX(number1, number2, ...)", description: "Returns the largest of one or more numbers."},
  {name: "MIN", category: "Math", minArgs: 1, maxArgs: null, signature: "MIN(number1, number2, ...)", description: "Returns the smallest of one or more numbers."},

  // Date & Time
  {name: "TODAY", category: "Date/Time", minArgs: 0, maxArgs: 0, signature: "TODAY()", description: "Returns the current date."},
  {name: "NOW", category: "Date/Time", minArgs: 0, maxArgs: 0, signature: "NOW()", description: "Returns the current date and time."},
  {name: "DATE", category: "Date/Time", minArgs: 3, maxArgs: 3, signature: "DATE(year, month, day)", description: "Returns a date value from the given year, month, and day."},
  {name: "DATEVALUE", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "DATEVALUE(expression)", description: "Returns a date value from a string or datetime."},
  {name: "DATETIMEVALUE", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "DATETIMEVALUE(expression)", description: "Returns a datetime value from a string."},
  {name: "TIMEVALUE", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "TIMEVALUE(expression)", description: "Returns a time value from a datetime or string."},
  {name: "DAY", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "DAY(date)", description: "Returns the day of the month (1-31) for a date."},
  {name: "MONTH", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "MONTH(date)", description: "Returns the month (1-12) for a date."},
  {name: "YEAR", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "YEAR(date)", description: "Returns the year for a date."},
  {name: "WEEKDAY", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "WEEKDAY(date)", description: "Returns the day of the week (1-7) for a date."},
  {name: "DAYSINMONTH", category: "Date/Time", minArgs: 2, maxArgs: 2, signature: "DAYSINMONTH(year, month)", description: "Returns the number of days in the given month of the given year."},
  {name: "ISOWEEK", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "ISOWEEK(date)", description: "Returns the ISO 8601 week number for a date."},
  {name: "ISOYEAR", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "ISOYEAR(date)", description: "Returns the ISO 8601 year for a date."},
  {name: "ADDMONTHS", category: "Date/Time", minArgs: 2, maxArgs: 2, signature: "ADDMONTHS(date, num)", description: "Returns a date that is a specified number of months away from a given date."},
  {name: "MILLISECOND", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "MILLISECOND(datetime)", description: "Returns the millisecond component of a datetime."},
  {name: "SECOND", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "SECOND(datetime)", description: "Returns the second component of a datetime."},
  {name: "MINUTE", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "MINUTE(datetime)", description: "Returns the minute component of a datetime."},
  {name: "HOUR", category: "Date/Time", minArgs: 1, maxArgs: 1, signature: "HOUR(datetime)", description: "Returns the hour component of a datetime."},

  // Advanced
  {name: "CURRENCYRATE", category: "Advanced", minArgs: 1, maxArgs: 1, signature: "CURRENCYRATE(iso_code)", description: "Returns the conversion rate for the given currency ISO code (multi-currency orgs only)."},
  {name: "INCLUDES", category: "Advanced", minArgs: 2, maxArgs: 2, signature: "INCLUDES(multiselect_picklist_field, text_literal)", description: "Returns TRUE if a multi-select picklist field includes a given value."},

  // Summary (roll-up summary / report formula context)
  {name: "PARENTGROUPVAL", category: "Summary", minArgs: 2, maxArgs: 3, signature: "PARENTGROUPVAL(summarized_field, grouping_level_1, [grouping_level_2])", description: "Returns the value of a summarized field for a parent grouping in a report."},
  {name: "PREVGROUPVAL", category: "Summary", minArgs: 2, maxArgs: 3, signature: "PREVGROUPVAL(summarized_field, grouping_level_1, [grouping_level_2])", description: "Returns the value of a summarized field for a previous grouping in a report."},
];

export const FORMULA_FUNCTIONS_BY_NAME = new Map(FORMULA_FUNCTIONS.map(f => [f.name, f]));

export const FORMULA_OPERATORS = ["<>", "<=", ">=", "&&", "||", "+", "-", "*", "/", "^", "&", "=", "<", ">", "!"];

export const FORMULA_LITERALS = ["TRUE", "FALSE", "NULL"];
