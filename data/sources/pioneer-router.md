# Pioneer Inference and Model Routing

## Base URL and authentication

The Pioneer inference API is served from `https://api.pioneer.ai/v1`. Requests
authenticate with the `X-API-Key` header. Platform endpoints such as
`/inferences` sit at the bare host without the `/v1` prefix.

Running inference requires a billing plan. Without one, requests return HTTP 403
with the code `card_required`.

## Two compatible surfaces

Pioneer exposes both an OpenAI-compatible and an Anthropic-compatible surface:

- `POST /v1/chat/completions` accepts the OpenAI Chat Completions request shape.
- `POST /v1/messages` accepts the Anthropic Messages request shape.

Fixed model IDs such as `claude-haiku-4-5` and `claude-sonnet-5` are served on
both. `GET /v1/models` lists every available model with its per-million-token
input and output pricing.

## The pioneer/auto router

Sending `model: "pioneer/auto"` routes the request automatically. The router
reads the messages, scores candidate models against the task, and dispatches to
the cheapest model that meets the quality bar.

Routing metadata is returned inline on the response body:

- `pioneer_routed_model` names the model that actually executed the request.
- `pioneer_inference_id` is the provider request identifier.
- `pioneer_savings` reports a per-million-token rate differential against a
  baseline model, together with the baseline and routed model names.

Note that `pioneer_savings` is a rate differential against Pioneer's own chosen
baseline, not a measurement of tokens saved by the caller.

## Token usage

Responses on the Anthropic-compatible surface report usage with the field names
`input_tokens`, `output_tokens`, `cache_read_input_tokens` and
`cache_creation_input_tokens`. The `input_tokens` field counts only the uncached
remainder, so a total prompt cost must add the two cache fields to it.
