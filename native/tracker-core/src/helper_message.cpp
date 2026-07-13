#include "helper_message.h"

#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <map>
#include <string>
#include <utility>

namespace lvk::tracker {
namespace {

// ---------------------------------------------------------------------------
// Minimal strict JSON value model + recursive-descent parser.
//
// Deliberately narrow: it supports only the value kinds the helper contract
// uses (objects, strings, numbers). It has no array/boolean/null support and no
// \u string escapes, because the contract never emits them; encountering them is
// a strict parse error rather than silently ignored input. This keeps the parser
// small and dependency-free while still rejecting malformed input, duplicate
// keys, trailing garbage, integer overflow, partial numeric tokens, and
// non-finite numbers.
// ---------------------------------------------------------------------------

struct JsonValue;
using JsonObject = std::map<std::string, JsonValue>;

struct JsonValue {
  enum class Type { Number, String, Object } type = Type::Number;
  // Number
  double number = 0.0;
  bool numberFinite = true;
  bool isInteger = false;
  bool integerOverflow = false;
  long long integer = 0;
  // String
  std::string str;
  // Object
  JsonObject object;
};

class StrictJsonParser {
 public:
  explicit StrictJsonParser(const std::string& text) : text_(text) {}

  bool parse(JsonValue& out, std::string& reason) {
    if (!parseValue(out, reason)) {
      return false;
    }
    skipWs();
    if (pos_ != text_.size()) {
      reason = "trailing garbage";
      return false;
    }
    return true;
  }

 private:
  const std::string& text_;
  std::size_t pos_ = 0;

  void skipWs() {
    while (pos_ < text_.size()) {
      const char c = text_[pos_];
      if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
        ++pos_;
      } else {
        break;
      }
    }
  }

  bool parseValue(JsonValue& out, std::string& reason) {
    skipWs();
    if (pos_ >= text_.size()) {
      reason = "unexpected end of input";
      return false;
    }
    const char c = text_[pos_];
    if (c == '{') {
      return parseObject(out, reason);
    }
    if (c == '"') {
      out.type = JsonValue::Type::String;
      return parseString(out.str, reason);
    }
    if (c == '-' || (c >= '0' && c <= '9')) {
      return parseNumber(out, reason);
    }
    reason = "unexpected token";
    return false;
  }

  bool parseObject(JsonValue& out, std::string& reason) {
    out.type = JsonValue::Type::Object;
    ++pos_;  // consume '{'
    skipWs();
    if (pos_ < text_.size() && text_[pos_] == '}') {
      ++pos_;
      return true;
    }
    while (true) {
      skipWs();
      if (pos_ >= text_.size() || text_[pos_] != '"') {
        reason = "expected string key";
        return false;
      }
      std::string key;
      if (!parseString(key, reason)) {
        return false;
      }
      skipWs();
      if (pos_ >= text_.size() || text_[pos_] != ':') {
        reason = "expected ':'";
        return false;
      }
      ++pos_;  // consume ':'
      JsonValue value;
      if (!parseValue(value, reason)) {
        return false;
      }
      if (out.object.find(key) != out.object.end()) {
        reason = "duplicate field";
        return false;
      }
      out.object.emplace(std::move(key), std::move(value));
      skipWs();
      if (pos_ >= text_.size()) {
        reason = "unterminated object";
        return false;
      }
      const char c = text_[pos_];
      if (c == ',') {
        ++pos_;
        continue;
      }
      if (c == '}') {
        ++pos_;
        return true;
      }
      reason = "expected ',' or '}'";
      return false;
    }
  }

  bool parseString(std::string& out, std::string& reason) {
    ++pos_;  // consume opening '"'
    std::string result;
    while (pos_ < text_.size()) {
      const char c = text_[pos_++];
      if (c == '"') {
        out = std::move(result);
        return true;
      }
      if (c == '\\') {
        if (pos_ >= text_.size()) {
          reason = "unterminated escape";
          return false;
        }
        const char e = text_[pos_++];
        switch (e) {
          case '"':
            result.push_back('"');
            break;
          case '\\':
            result.push_back('\\');
            break;
          case '/':
            result.push_back('/');
            break;
          case 'n':
            result.push_back('\n');
            break;
          case 't':
            result.push_back('\t');
            break;
          case 'r':
            result.push_back('\r');
            break;
          case 'b':
            result.push_back('\b');
            break;
          case 'f':
            result.push_back('\f');
            break;
          default:
            reason = "unsupported string escape";
            return false;
        }
        continue;
      }
      if (static_cast<unsigned char>(c) < 0x20) {
        reason = "control character in string";
        return false;
      }
      result.push_back(c);
    }
    reason = "unterminated string";
    return false;
  }

  bool parseNumber(JsonValue& out, std::string& reason) {
    const std::size_t start = pos_;
    bool isInteger = true;

    if (pos_ < text_.size() && text_[pos_] == '-') {
      ++pos_;
    }

    const std::size_t intStart = pos_;
    while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
      ++pos_;
    }
    if (pos_ == intStart) {
      reason = "invalid number";
      return false;
    }

    if (pos_ < text_.size() && text_[pos_] == '.') {
      isInteger = false;
      ++pos_;
      const std::size_t fracStart = pos_;
      while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
        ++pos_;
      }
      if (pos_ == fracStart) {
        reason = "invalid fraction";
        return false;
      }
    }

    if (pos_ < text_.size() && (text_[pos_] == 'e' || text_[pos_] == 'E')) {
      isInteger = false;
      ++pos_;
      if (pos_ < text_.size() && (text_[pos_] == '+' || text_[pos_] == '-')) {
        ++pos_;
      }
      const std::size_t expStart = pos_;
      while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
        ++pos_;
      }
      if (pos_ == expStart) {
        reason = "invalid exponent";
        return false;
      }
    }

    const std::string token = text_.substr(start, pos_ - start);
    out.type = JsonValue::Type::Number;
    out.isInteger = isInteger;

    errno = 0;
    char* end = nullptr;
    const double asDouble = std::strtod(token.c_str(), &end);
    if (end != token.c_str() + token.size()) {
      reason = "invalid number token";
      return false;
    }
    out.number = asDouble;
    out.numberFinite = std::isfinite(asDouble) != 0;

    if (isInteger) {
      errno = 0;
      char* intEnd = nullptr;
      const long long asInteger = std::strtoll(token.c_str(), &intEnd, 10);
      if (intEnd != token.c_str() + token.size()) {
        reason = "invalid integer token";
        return false;
      }
      out.integerOverflow = (errno == ERANGE);
      out.integer = asInteger;
    }

    return true;
  }
};

// --- Typed field extraction helpers ----------------------------------------

const JsonValue* findField(const JsonObject& object, const char* key) {
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &it->second;
}

bool getString(
    const JsonObject& object,
    const char* key,
    std::string& out,
    std::string& reason) {
  const JsonValue* value = findField(object, key);
  if (value == nullptr) {
    reason = std::string("missing field: ") + key;
    return false;
  }
  if (value->type != JsonValue::Type::String) {
    reason = std::string("non-string field: ") + key;
    return false;
  }
  out = value->str;
  return true;
}

bool getInteger(
    const JsonObject& object,
    const char* key,
    long long& out,
    std::string& reason) {
  const JsonValue* value = findField(object, key);
  if (value == nullptr) {
    reason = std::string("missing field: ") + key;
    return false;
  }
  if (value->type != JsonValue::Type::Number || !value->isInteger) {
    reason = std::string("non-integer field: ") + key;
    return false;
  }
  if (value->integerOverflow) {
    reason = std::string("integer overflow: ") + key;
    return false;
  }
  out = value->integer;
  return true;
}

bool getFiniteDouble(
    const JsonObject& object,
    const char* key,
    double& out,
    std::string& reason) {
  const JsonValue* value = findField(object, key);
  if (value == nullptr) {
    reason = std::string("missing field: ") + key;
    return false;
  }
  if (value->type != JsonValue::Type::Number) {
    reason = std::string("non-numeric field: ") + key;
    return false;
  }
  if (!value->numberFinite) {
    reason = std::string("non-finite field: ") + key;
    return false;
  }
  out = value->number;
  return true;
}

bool getObject(
    const JsonObject& object,
    const char* key,
    const JsonObject*& out,
    std::string& reason) {
  const JsonValue* value = findField(object, key);
  if (value == nullptr) {
    reason = std::string("missing field: ") + key;
    return false;
  }
  if (value->type != JsonValue::Type::Object) {
    reason = std::string("non-object field: ") + key;
    return false;
  }
  out = &value->object;
  return true;
}

bool requireExactSchemaVersionOne(
    const JsonObject& object, std::string& reason) {
  long long schemaVersion = 0;
  if (!getInteger(object, "schemaVersion", schemaVersion, reason)) {
    return false;
  }
  if (schemaVersion != 1) {
    reason = "unexpected schemaVersion";
    return false;
  }
  return true;
}

bool requireType(
    const JsonObject& object, const char* expected, std::string& reason) {
  std::string type;
  if (!getString(object, "type", type, reason)) {
    return false;
  }
  if (type != expected) {
    reason = std::string("unexpected type: ") + type;
    return false;
  }
  return true;
}

bool parseObjectLine(
    const std::string& line, JsonValue& out, std::string& reason) {
  StrictJsonParser parser(line);
  if (!parser.parse(out, reason)) {
    return false;
  }
  if (out.type != JsonValue::Type::Object) {
    reason = "top-level value is not an object";
    return false;
  }
  return true;
}

bool parseStatus(const std::string& text, HelperTrackingStatus& status) {
  if (text == "tracking") {
    status = HelperTrackingStatus::Tracking;
    return true;
  }
  if (text == "lost") {
    status = HelperTrackingStatus::Lost;
    return true;
  }
  if (text == "not_started") {
    status = HelperTrackingStatus::NotStarted;
    return true;
  }
  return false;
}

}  // namespace

HelperLineType classifyHelperLine(const std::string& line) {
  JsonValue root;
  std::string reason;
  if (!parseObjectLine(line, root, reason)) {
    return HelperLineType::Unknown;
  }
  std::string type;
  if (!getString(root.object, "type", type, reason)) {
    return HelperLineType::Unknown;
  }
  if (type == "ready") {
    return HelperLineType::Ready;
  }
  if (type == "result") {
    return HelperLineType::Result;
  }
  if (type == "stopping") {
    return HelperLineType::Stopping;
  }
  if (type == "stopped") {
    return HelperLineType::Stopped;
  }
  return HelperLineType::Unknown;
}

bool parseHelperReadyLine(const std::string& line, std::string& reason) {
  JsonValue root;
  if (!parseObjectLine(line, root, reason)) {
    return false;
  }
  if (!requireType(root.object, "ready", reason)) {
    return false;
  }
  if (!requireExactSchemaVersionOne(root.object, reason)) {
    return false;
  }
  std::string source;
  if (!getString(root.object, "source", source, reason)) {
    return false;
  }
  if (source != "synthetic-helper") {
    reason = "unexpected ready source";
    return false;
  }
  return true;
}

bool parseHelperStoppedLine(const std::string& line, std::string& reason) {
  JsonValue root;
  if (!parseObjectLine(line, root, reason)) {
    return false;
  }
  if (!requireType(root.object, "stopped", reason)) {
    return false;
  }
  if (!requireExactSchemaVersionOne(root.object, reason)) {
    return false;
  }
  return true;
}

bool parseHelperResultEnvelope(
    const std::string& line, ParsedHelperResult& out, std::string& reason) {
  JsonValue root;
  if (!parseObjectLine(line, root, reason)) {
    return false;
  }
  const JsonObject& object = root.object;

  if (!requireType(object, "result", reason)) {
    return false;
  }
  if (!requireExactSchemaVersionOne(object, reason)) {
    return false;
  }

  long long requestId = 0;
  if (!getInteger(object, "requestId", requestId, reason)) {
    return false;
  }
  if (requestId < 0) {
    reason = "negative requestId";
    return false;
  }

  long long frameTimestampMs = 0;
  if (!getInteger(object, "frameTimestampMs", frameTimestampMs, reason)) {
    return false;
  }

  std::string statusText;
  if (!getString(object, "status", statusText, reason)) {
    return false;
  }
  HelperTrackingStatus status = HelperTrackingStatus::NotStarted;
  if (!parseStatus(statusText, status)) {
    reason = "invalid status value";
    return false;
  }

  double confidence = 0.0;
  if (!getFiniteDouble(object, "confidence", confidence, reason)) {
    return false;
  }

  const JsonObject* faceRotation = nullptr;
  if (!getObject(object, "faceRotation", faceRotation, reason)) {
    return false;
  }
  double pitch = 0.0;
  double yaw = 0.0;
  double roll = 0.0;
  if (!getFiniteDouble(*faceRotation, "pitch", pitch, reason) ||
      !getFiniteDouble(*faceRotation, "yaw", yaw, reason) ||
      !getFiniteDouble(*faceRotation, "roll", roll, reason)) {
    return false;
  }

  const JsonObject* eyes = nullptr;
  if (!getObject(object, "eyes", eyes, reason)) {
    return false;
  }
  double leftOpen = 0.0;
  double rightOpen = 0.0;
  if (!getFiniteDouble(*eyes, "leftOpen", leftOpen, reason) ||
      !getFiniteDouble(*eyes, "rightOpen", rightOpen, reason)) {
    return false;
  }

  const JsonObject* mouth = nullptr;
  if (!getObject(object, "mouth", mouth, reason)) {
    return false;
  }
  double mouthOpen = 0.0;
  double mouthSmile = 0.0;
  if (!getFiniteDouble(*mouth, "open", mouthOpen, reason) ||
      !getFiniteDouble(*mouth, "smile", mouthSmile, reason)) {
    return false;
  }

  // Optional diagnostic block. If present it must be an object; inferenceMs, if
  // present, must be finite. It never leaves Native Core.
  double inferenceMs = 0.0;
  if (findField(object, "diag") != nullptr) {
    const JsonObject* diag = nullptr;
    if (!getObject(object, "diag", diag, reason)) {
      return false;
    }
    if (findField(*diag, "inferenceMs") != nullptr &&
        !getFiniteDouble(*diag, "inferenceMs", inferenceMs, reason)) {
      return false;
    }
  }

  out.requestId = static_cast<std::uint64_t>(requestId);
  out.frameTimestampMs = frameTimestampMs;
  out.payload.timestampMs = frameTimestampMs;
  out.payload.status = status;
  out.payload.confidence = confidence;
  out.payload.faceRotation = HelperFaceRotation{pitch, yaw, roll};
  out.payload.eyes = HelperEyeState{leftOpen, rightOpen};
  out.payload.mouth = HelperMouthState{mouthOpen, mouthSmile};
  out.payload.inferenceMs = inferenceMs;
  return true;
}

}  // namespace lvk::tracker
