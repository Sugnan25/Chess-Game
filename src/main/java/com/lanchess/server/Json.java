package com.lanchess.server;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A very small JSON reader and writer.
 *
 * <p>The game only ever talks to its own web interface, so this stays in the
 * project rather than pulling in a dependency. It covers exactly what the API
 * needs: objects, arrays, strings, numbers, booleans and null.
 */
public final class Json {

    private Json() {
    }

    // ------------------------------------------------------------------
    // Writing
    // ------------------------------------------------------------------

    /** An ordered map that serialises itself to a JSON object. */
    public static final class Obj {
        private final Map<String, Object> values = new LinkedHashMap<String, Object>();

        public Obj put(String key, String value) {
            this.values.put(key, value);
            return this;
        }

        public Obj put(String key, long value) {
            this.values.put(key, Long.valueOf(value));
            return this;
        }

        public Obj put(String key, int value) {
            this.values.put(key, Integer.valueOf(value));
            return this;
        }

        public Obj put(String key, boolean value) {
            this.values.put(key, Boolean.valueOf(value));
            return this;
        }

        public Obj put(String key, Obj value) {
            this.values.put(key, value);
            return this;
        }

        public Obj put(String key, Arr value) {
            this.values.put(key, value);
            return this;
        }

        /** Stores null when the value is null, so the key still appears. */
        public Obj putNullable(String key, String value) {
            this.values.put(key, value);
            return this;
        }

        public boolean has(String key) {
            return this.values.containsKey(key);
        }

        public String string(String key) {
            Object value = this.values.get(key);
            return value == null ? null : String.valueOf(value);
        }

        @Override
        public String toString() {
            StringBuilder out = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<String, Object> entry : this.values.entrySet()) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                escape(out, entry.getKey());
                out.append(':');
                write(out, entry.getValue());
            }
            return out.append('}').toString();
        }
    }

    /** A JSON array. */
    public static final class Arr {
        private final List<Object> values = new ArrayList<Object>();

        public Arr add(String value) {
            this.values.add(value);
            return this;
        }

        public Arr add(int value) {
            this.values.add(Integer.valueOf(value));
            return this;
        }

        public Arr add(boolean value) {
            this.values.add(Boolean.valueOf(value));
            return this;
        }

        public Arr add(Obj value) {
            this.values.add(value);
            return this;
        }

        public int size() {
            return this.values.size();
        }

        @Override
        public String toString() {
            StringBuilder out = new StringBuilder("[");
            for (int i = 0; i < this.values.size(); i++) {
                if (i > 0) {
                    out.append(',');
                }
                write(out, this.values.get(i));
            }
            return out.append(']').toString();
        }
    }

    private static void write(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof Obj || value instanceof Arr) {
            out.append(value.toString());
        } else if (value instanceof Boolean) {
            out.append(((Boolean)value).booleanValue() ? "true" : "false");
        } else if (value instanceof Number) {
            out.append(value.toString());
        } else {
            escape(out, String.valueOf(value));
        }
    }

    private static void escape(StringBuilder out, String text) {
        out.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"':
                    out.append("\\\"");
                    break;
                case '\\':
                    out.append("\\\\");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                case '\t':
                    out.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", Integer.valueOf(c)));
                    } else {
                        out.append(c);
                    }
            }
        }
        out.append('"');
    }

    // ------------------------------------------------------------------
    // Reading
    // ------------------------------------------------------------------

    /** A parsed JSON value. */
    public static final class Value {
        private final Object data;

        private Value(Object data) {
            this.data = data;
        }

        public boolean isObject() {
            return this.data instanceof Map;
        }

        public String string(String key, String fallback) {
            if (!(this.data instanceof Map)) {
                return fallback;
            }
            Object value = ((Map<?, ?>)this.data).get(key);
            return value == null ? fallback : String.valueOf(value);
        }

        public int integer(String key, int fallback) {
            if (!(this.data instanceof Map)) {
                return fallback;
            }
            Object value = ((Map<?, ?>)this.data).get(key);
            if (value instanceof Number) {
                return ((Number)value).intValue();
            }
            if (value == null) {
                return fallback;
            }
            try {
                return Integer.parseInt(String.valueOf(value).trim());
            } catch (NumberFormatException e) {
                return fallback;
            }
        }

        public boolean flag(String key, boolean fallback) {
            if (!(this.data instanceof Map)) {
                return fallback;
            }
            Object value = ((Map<?, ?>)this.data).get(key);
            if (value instanceof Boolean) {
                return ((Boolean)value).booleanValue();
            }
            if (value == null) {
                return fallback;
            }
            return Boolean.parseBoolean(String.valueOf(value));
        }

        /** The object stored under the key, or an empty value. */
        public Value child(String key) {
            if (this.data instanceof Map) {
                Object value = ((Map<?, ?>)this.data).get(key);
                if (value instanceof Map) {
                    return new Value(value);
                }
            }
            return new Value(null);
        }

        /** The array stored under the key, or an empty array. */
        public int[] integers(String key) {
            List<?> list = this.list(key);
            int[] values = new int[list.size()];
            for (int i = 0; i < values.length; i++) {
                Object value = list.get(i);
                values[i] = value instanceof Number
                        ? ((Number)value).intValue()
                        : Integer.parseInt(String.valueOf(value).trim());
            }
            return values;
        }

        private List<?> list(String key) {
            if (!(this.data instanceof Map)) {
                return Collections.emptyList();
            }
            Object value = ((Map<?, ?>)this.data).get(key);
            return value instanceof List ? (List<?>)value : Collections.emptyList();
        }

        /** The raw text, trimmed, or fallback when absent or blank. */
        public String trimmed(String key, String fallback) {
            String value = this.string(key, null);
            if (value == null) {
                return fallback;
            }
            String cleaned = value.trim();
            return cleaned.isEmpty() ? fallback : cleaned;
        }
    }

    public static Value parse(String text) {
        if (text == null) {
            return new Value(null);
        }
        Parser parser = new Parser(text);
        try {
            return new Value(parser.value());
        } catch (RuntimeException e) {
            return new Value(null);
        }
    }

    private static final class Parser {
        private final String text;
        private int at;

        Parser(String text) {
            this.text = text;
        }

        Object value() {
            this.space();
            if (this.at >= this.text.length()) {
                return null;
            }
            char c = this.text.charAt(this.at);
            switch (c) {
                case '{':
                    return this.object();
                case '[':
                    return this.array();
                case '"':
                    return this.string();
                case 't':
                    this.expect("true");
                    return Boolean.TRUE;
                case 'f':
                    this.expect("false");
                    return Boolean.FALSE;
                case 'n':
                    this.expect("null");
                    return null;
                default:
                    return this.number();
            }
        }

        private Map<String, Object> object() {
            Map<String, Object> map = new LinkedHashMap<String, Object>();
            this.at++;
            this.space();
            if (this.peek() == '}') {
                this.at++;
                return map;
            }
            while (true) {
                this.space();
                String key = this.string();
                this.space();
                if (this.peek() != ':') {
                    throw new IllegalStateException("expected : at " + this.at);
                }
                this.at++;
                map.put(key, this.value());
                this.space();
                char c = this.peek();
                this.at++;
                if (c == '}') {
                    return map;
                }
                if (c != ',') {
                    throw new IllegalStateException("expected , or } at " + this.at);
                }
            }
        }

        private List<Object> array() {
            List<Object> list = new ArrayList<Object>();
            this.at++;
            this.space();
            if (this.peek() == ']') {
                this.at++;
                return list;
            }
            while (true) {
                list.add(this.value());
                this.space();
                char c = this.peek();
                this.at++;
                if (c == ']') {
                    return list;
                }
                if (c != ',') {
                    throw new IllegalStateException("expected , or ] at " + this.at);
                }
            }
        }

        private String string() {
            if (this.peek() != '"') {
                throw new IllegalStateException("expected a string at " + this.at);
            }
            this.at++;
            StringBuilder out = new StringBuilder();
            while (this.at < this.text.length()) {
                char c = this.text.charAt(this.at++);
                if (c == '"') {
                    return out.toString();
                }
                if (c != '\\') {
                    out.append(c);
                    continue;
                }
                char escape = this.text.charAt(this.at++);
                switch (escape) {
                    case 'n':
                        out.append('\n');
                        break;
                    case 'r':
                        out.append('\r');
                        break;
                    case 't':
                        out.append('\t');
                        break;
                    case 'b':
                        out.append('\b');
                        break;
                    case 'f':
                        out.append('\f');
                        break;
                    case 'u':
                        out.append((char)Integer.parseInt(this.text.substring(this.at, this.at + 4), 16));
                        this.at += 4;
                        break;
                    default:
                        out.append(escape);
                }
            }
            throw new IllegalStateException("unterminated string");
        }

        private Object number() {
            int start = this.at;
            while (this.at < this.text.length() && "-+.eE0123456789".indexOf(this.text.charAt(this.at)) >= 0) {
                this.at++;
            }
            if (start == this.at) {
                throw new IllegalStateException("expected a value at " + this.at);
            }
            String raw = this.text.substring(start, this.at);
            if (raw.indexOf('.') < 0 && raw.indexOf('e') < 0 && raw.indexOf('E') < 0) {
                try {
                    return Long.valueOf(Long.parseLong(raw));
                } catch (NumberFormatException e) {
                    // fall through to double
                }
            }
            return Double.valueOf(Double.parseDouble(raw));
        }

        private void expect(String word) {
            if (!this.text.startsWith(word, this.at)) {
                throw new IllegalStateException("expected " + word + " at " + this.at);
            }
            this.at += word.length();
        }

        private char peek() {
            return this.at < this.text.length() ? this.text.charAt(this.at) : '\0';
        }

        private void space() {
            while (this.at < this.text.length() && Character.isWhitespace(this.text.charAt(this.at))) {
                this.at++;
            }
        }
    }
}
