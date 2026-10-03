package com.lanchess;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.lanchess.server.Json;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

class JsonTest {

    @Nested
    @DisplayName("writing")
    class Writing {

        @Test
        @DisplayName("an empty object and array are written in the short form")
        void writesEmptyContainers() {
            assertEquals("{}", new Json.Obj().toString());
            assertEquals("[]", new Json.Arr().toString());
        }

        @Test
        @DisplayName("keys keep the order they were added in")
        void keepsInsertionOrder() {
            String text = new Json.Obj().put("b", 1).put("a", 2).put("c", 3).toString();
            assertEquals("{\"b\":1,\"a\":2,\"c\":3}", text);
        }

        @Test
        @DisplayName("a null value keeps its key")
        void keepsNullKeys() {
            assertEquals("{\"piece\":null}", new Json.Obj().putNullable("piece", null).toString());
        }

        @Test
        @DisplayName("quotes, backslashes and newlines are escaped")
        void escapesStrings() {
            String text = new Json.Obj().put("a", "he said \"hi\"\nand \\ left").toString();
            assertEquals("{\"a\":\"he said \\\"hi\\\"\\nand \\\\ left\"}", text);
        }

        @Test
        @DisplayName("a control character becomes a unicode escape")
        void escapesControlCharacters() {
            assertEquals("{\"a\":\"\\u0001\"}", new Json.Obj().put("a", "\u0001").toString());
        }

        @Test
        @DisplayName("arrays nest objects")
        void writesNestedArrays() {
            String text = new Json.Arr().add(1).add(new Json.Obj().put("x", true)).add("s").toString();
            assertEquals("[1,{\"x\":true},\"s\"]", text);
        }
    }

    @Nested
    @DisplayName("reading")
    class Reading {

        @Test
        @DisplayName("an object keeps its types")
        void readsAnObject() {
            Json.Value value = Json.parse("{\"n\":12,\"s\":\"hi\",\"b\":false,\"z\":null}");
            assertEquals(12, value.integer("n", -1));
            assertEquals("hi", value.string("s", ""));
            assertFalse(value.flag("b", true));
            assertNull(value.string("z", null));
        }

        @Test
        @DisplayName("a number may be written as a string")
        void readsNumbersFromStrings() {
            assertEquals(7, Json.parse("{\"n\":\"7\"}").integer("n", -1));
            assertEquals(7, Json.parse("{\"n\":\" 7 \"}").integer("n", -1));
        }

        @Test
        @DisplayName("a missing or unusable value falls back")
        void fallsBackOnRubbish() {
            Json.Value value = Json.parse("{\"n\":true,\"s\":\"hello\"}");
            assertEquals(3, value.integer("n", 3));
            assertEquals(3, value.integer("missing", 3));
            // string() renders any value that is there, whatever its type.
            assertEquals("true", value.string("n", "d"));
            assertEquals("d", value.string("missing", "d"));
            // Only the word true counts; anything else is not a flag.
            assertFalse(value.flag("s", true));
            assertTrue(value.flag("missing", true));
        }

        @Test
        @DisplayName("arrays become int arrays")
        void readsArrays() {
            assertArrayEquals(new int[] {4, 36, 44}, Json.parse("{\"t\":[4,36,44]}").integers("t"));
            assertArrayEquals(new int[0], Json.parse("{\"t\":[]}").integers("t"));
            assertArrayEquals(new int[0], Json.parse("{}").integers("t"));
        }

        @Test
        @DisplayName("a nested object can be read on its own")
        void readsNestedObjects() {
            Json.Value value = Json.parse("{\"m\":{\"from\":52,\"to\":44}}");
            assertEquals(52, value.child("m").integer("from", -1));
            assertEquals(44, value.child("m").integer("to", -1));
            assertEquals(-1, value.child("missing").integer("from", -1));
        }

        @Test
        @DisplayName("escapes are understood")
        void readsEscapes() {
            Json.Value value = Json.parse("{\"a\":\"q\\\"b\",\"b\":\"x\\u0041y\",\"c\":\"l1\\nl2\"}");
            assertEquals("q\"b", value.string("a", ""));
            assertEquals("xAy", value.string("b", ""));
            assertEquals("l1\nl2", value.string("c", ""));
        }

        @Test
        @DisplayName("junk and empty text give an empty value instead of throwing")
        void survivesRubbish() {
            assertEquals(1, Json.parse(null).integer("anything", 1));
            assertEquals(1, Json.parse("").integer("anything", 1));
            assertEquals(1, Json.parse("{not json").integer("anything", 1));
            assertEquals(1, Json.parse("<html>oops</html>").integer("anything", 1));
        }

        @Test
        @DisplayName("a trimmed value drops surrounding space and treats blank as absent")
        void trimsStrings() {
            Json.Value value = Json.parse("{\"a\":\"  x  \",\"b\":\"   \"}");
            assertEquals("x", value.trimmed("a", "?"));
            assertEquals("?", value.trimmed("b", "?"));
        }
    }

    @Test
    @DisplayName("what is written can be read back")
    void roundTrips() {
        Json.Obj source = new Json.Obj()
                .put("name", "Ana \"The Queen\"")
                .put("room", "1234")
                .put("depth", 6)
                .put("ready", true)
                .putNullable("promotion", null);
        source.put("targets", new Json.Arr().add(36).add(44));
        source.put("last", new Json.Obj().put("from", 52).put("to", 44));

        Json.Value back = Json.parse(source.toString());
        assertEquals("Ana \"The Queen\"", back.string("name", ""));
        assertEquals(1234, back.integer("room", 0));
        assertEquals(6, back.integer("depth", 0));
        assertTrue(back.flag("ready", false));
        assertNull(back.string("promotion", null));
        // A JSON null reads the same as a missing key.
        assertEquals("?", back.string("promotion", "?"));
        assertArrayEquals(new int[] {36, 44}, back.integers("targets"));
        assertEquals(44, back.child("last").integer("to", -1));
    }
}
