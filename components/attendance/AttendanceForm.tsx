"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BrandMark } from "@/components/BrandMark";
import { supabase } from "@/lib/supabase/client";
import { isCountryCode, matchCountry } from "@/lib/countries";
import CountryCombobox from "@/components/attendance/CountryCombobox";
import {
  forgetSavedDetails,
  loadSavedDetails,
  saveDetails,
  type SavedDetails,
} from "@/lib/savedDetails";
import { NOTICE_VERSION, TERMS_VERSION } from "@/lib/legal";
import { formatDateTime } from "@/lib/attendance/window";
import { nowMs } from "@/lib/dates";
import type { FormTexts, PublicEvent } from "@/types/attendance";

const UNIVERSITIES = ["LMU", "TUM", "Other"] as const;
const EXCHANGE_PROGRAMS = ["Erasmus+", "LMUexchange", "Full-time degree", "Other"] as const;

// The statistics questions are optional: "" (or nothing picked) means not given.
const schema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(200, "Please shorten your first name"),
  last_name: z.string().trim().min(1, "Last name is required").max(200, "Please shorten your last name"),
  nationality: z
    .string()
    // ISO code from the country picker (raw text while nothing matches).
    .refine((v) => v === "" || isCountryCode(v), "Please pick a country from the list, or leave it empty"),
  university: z.enum(["", ...UNIVERSITIES]).nullish(),
  exchange_program: z.enum(["", ...EXCHANGE_PROGRAMS]).nullish(),
  esn_card: z.enum(["", "yes", "no"]).nullish(),
  terms_accepted: z.boolean().refine((v) => v === true, {
    message: "Please accept the participation terms to sign in.",
  }),
});

type FormData = z.infer<typeof schema>;

// details → (submitted) → ask to remember details → done
type Step = "form" | "save" | "done";

const inputClass =
  "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-esn-accent";

// Seconds the kiosk "thank you" screen stays up before the next person's form.
const KIOSK_RESET_SECONDS = 5;

/** A full-screen card for the states without a form. */
function Notice({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center max-w-sm w-full">
        <div className="text-4xl mb-3">{icon}</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">{title}</h2>
        <p className="text-gray-600 text-sm">{children}</p>
      </div>
    </main>
  );
}

/** Shown instead of the form once the list is closed (signed off, or 24 hours after the event). */
export function SignInsClosed({ title }: { title: string }) {
  return (
    <Notice icon="🔒" title="Sign-ins are closed">
      The attendance list for <span className="font-medium">{title}</span> is closed. Please talk
      to the organisers if you attended but could not sign in.
    </Notice>
  );
}

/** Shown before the window opens (2 hours before the event). */
function SignInsNotOpenYet({ event }: { event: PublicEvent }) {
  return (
    <Notice icon="⏳" title="Sign-ins are not open yet">
      You can sign in to <span className="font-medium">{event.title}</span> from{" "}
      <span className="font-medium">{formatDateTime(event.opens_at)}</span>.
    </Notice>
  );
}

interface Props {
  event: PublicEvent;
  /** Participation terms and data processing notice from legal/ */
  texts: FormTexts;
  /**
   * Set when the form runs on an organiser's device for participants without
   * a phone or internet. Saved details are neither offered nor pre-filled
   * (the device is shared) and the form starts over after each sign-in.
   */
  kiosk?: {
    /** Email of the signed-in organiser (shown; the database records it from the session) */
    recordedBy: string;
    /** Called when the next person may sign in */
    onNext: () => void;
  };
}

export default function AttendanceForm({ event, texts, kiosk }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  // Whether the form was pre-filled from details saved on this device.
  const [usedSaved, setUsedSaved] = useState(false);
  const [submittedDetails, setSubmittedDetails] = useState<SavedDetails | null>(null);
  // The list was closed while the form was open.
  const [closed, setClosed] = useState(event.closed);
  const [notOpenYet, setNotOpenYet] = useState(() => Date.now() < new Date(event.opens_at).getTime());
  const isKiosk = kiosk !== undefined;
  const onNext = kiosk?.onNext;

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { nationality: "" } });

  // Waiting for the window: open the form by itself when it starts.
  useEffect(() => {
    if (!notOpenYet) return;
    const wait = new Date(event.opens_at).getTime() - Date.now();
    // setTimeout overflows after ~24.8 days; nobody waits on the page that long.
    if (wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => setNotOpenYet(false), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [notOpenYet, event.opens_at]);

  useEffect(() => {
    if (isKiosk) return;
    const saved = loadSavedDetails();
    if (saved) {
      // Values come from browser storage – anything invalid is caught by validation on submit.
      reset({
        ...saved,
        // Details saved before codes were used hold a country name.
        nationality: !saved.nationality || isCountryCode(saved.nationality)
          ? saved.nationality ?? ""
          : (matchCountry(saved.nationality) ?? ""),
        terms_accepted: false,
      } as FormData);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- once, after reading browser storage
      setUsedSaved(true);
    }
  }, [isKiosk, reset]);

  // Kiosk: show the thank-you screen briefly, then start over for the next person.
  const [secondsLeft, setSecondsLeft] = useState(KIOSK_RESET_SECONDS);
  useEffect(() => {
    if (!onNext || step !== "done") return;
    if (secondsLeft <= 0) {
      onNext();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [onNext, step, secondsLeft]);

  function handleForget() {
    forgetSavedDetails();
    setUsedSaved(false);
    reset({
      first_name: "",
      last_name: "",
      nationality: "",
      university: null,
      exchange_program: null,
      esn_card: null,
      terms_accepted: false,
    } as FormData);
  }

  async function submitAttendance(data: FormData) {
    setSubmitting(true);
    setError(null);

    const details: SavedDetails = {
      first_name: data.first_name,
      last_name: data.last_name,
      nationality: data.nationality,
      university: data.university ?? "",
      exchange_program: data.exchange_program ?? "",
      esn_card: data.esn_card ?? "",
    };

    try {
      // public.sign_in() stores the name and counts the optional answers for
      // the event's statistics – they are never stored with the name.
      const { error: insertError } = await supabase.rpc("sign_in", {
        event: event.id,
        first_name: details.first_name,
        last_name: details.last_name,
        // What this person was shown and accepted (Art. 5(2) GDPR, § 305(2) BGB).
        notice_version: NOTICE_VERSION,
        terms_version: TERMS_VERSION,
        // Optional answers: left out (null in the database) when not given.
        nationality: details.nationality || undefined,
        university: details.university || undefined,
        exchange_program: details.exchange_program || undefined,
        esn_card: details.esn_card ? details.esn_card === "yes" : undefined,
        // Recorded under the signed-in organiser's email by the database.
        kiosk: isKiosk,
      });

      if (insertError) {
        // Refused outside the window or after the sign-off.
        if (insertError.code === "42501") {
          if (nowMs() < new Date(event.opens_at).getTime()) setNotOpenYet(true);
          else setClosed(true);
          return;
        }
        throw insertError;
      }

      if (isKiosk) {
        // Shared device – never remember anyone's details.
        setStep("done");
      } else {
        // Details are only stored when the participant says yes – every time.
        setSubmittedDetails(details);
        setStep("save");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (closed) return <SignInsClosed title={event.title} />;
  if (notOpenYet) return <SignInsNotOpenYet event={event} />;

  if (step === "save" || step === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center max-w-sm w-full">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Thank you!</h2>
          <p className="text-gray-600 text-sm">
            Your attendance for <span className="font-medium">{event.title}</span> has been recorded.
          </p>

          {step === "save" && submittedDetails && (
            <div className="mt-6 pt-6 border-t border-gray-200 text-left">
              <h3 className="text-sm font-semibold text-gray-900">
                {usedSaved ? "Keep your details saved for next time?" : "Save your details for next time?"}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                We can store your name and the optional answers you gave in this browser on this
                device, so the form is filled in automatically at the next event.
                {usedSaved
                  ? " “No, thanks” removes the details saved earlier."
                  : " Nothing is stored unless you choose to save."}
              </p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    saveDetails(submittedDetails);
                    setStep("done");
                  }}
                  className="flex-1 bg-esn text-white py-2 px-3 rounded-md text-sm font-medium hover:bg-esn-dark transition-colors"
                >
                  Save my details
                </button>
                <button
                  onClick={() => {
                    // Declining also withdraws an earlier yes.
                    forgetSavedDetails();
                    setUsedSaved(false);
                    setStep("done");
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 px-3 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  No, thanks
                </button>
              </div>
            </div>
          )}

          {kiosk && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Please hand the device back to the organiser. The form opens again for
                the next person in {secondsLeft} s.
              </p>
              <button
                onClick={kiosk.onNext}
                className="mt-4 w-full bg-esn text-white py-2 px-3 rounded-md text-sm font-medium hover:bg-esn-dark transition-colors"
              >
                Next person
              </button>
            </div>
          )}

          {!kiosk && step === "done" && loadSavedDetails() && (
            <p className="text-xs text-gray-500 mt-6">
              Your details are saved on this device for next time.{" "}
              <button
                onClick={() => {
                  forgetSavedDetails();
                  setUsedSaved(false);
                  setSubmittedDetails(null);
                }}
                className="text-esn underline"
              >
                Remove them
              </button>
            </p>
          )}
        </div>
      </main>
    );
  }

  const radio = "h-4 w-4 border-gray-300 text-esn focus:ring-esn-accent";
  const option = "flex items-center gap-1.5 cursor-pointer text-sm text-gray-700";

  return (
    <main className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-10">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-lg w-full overflow-hidden">
        {/* ESN branding strip */}
        <div className="bg-esn px-6 py-4 flex items-center gap-3">
          <BrandMark />
        </div>

        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
            <p className="text-xs text-gray-400 mt-1">
              {formatDateTime(event.event_date).replace(/ at .*$/, "")}
            </p>
          </div>

          {usedSaved && (
            <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-gray-700">
              We filled in your saved details – please check them, then sign in.{" "}
              <button type="button" onClick={handleForget} className="text-esn underline">
                Not you? Remove saved details
              </button>
            </div>
          )}

          <form
            onSubmit={handleSubmit(submitAttendance)}
            className="space-y-4"
            autoComplete={isKiosk ? "off" : undefined}
          >
            {/* Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First name <span className="text-red-500">*</span>
                </label>
                <input
                  {...register("first_name")}
                  type="text"
                  // Kiosk: the browser must not remember (and suggest) earlier participants.
                  autoComplete={isKiosk ? "off" : "given-name"}
                  className={inputClass}
                />
                {errors.first_name && (
                  <p className="text-red-500 text-xs mt-1">{errors.first_name.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last name <span className="text-red-500">*</span>
                </label>
                <input
                  {...register("last_name")}
                  type="text"
                  autoComplete={isKiosk ? "off" : "family-name"}
                  className={inputClass}
                />
                {errors.last_name && (
                  <p className="text-red-500 text-xs mt-1">{errors.last_name.message}</p>
                )}
              </div>
            </div>

            {/* Optional details, only ever counted */}
            <fieldset className="rounded-lg border border-gray-200 p-4 space-y-4">
              <legend className="px-1 text-sm font-semibold text-gray-700">Optional</legend>
              <p className="text-xs text-gray-500 -mt-2">
                For anonymous statistics only: we count your answers for this event and never
                store them with your name.
              </p>

              {/* Nationality – type to search, validated against the list */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nationality</label>
                <Controller
                  name="nationality"
                  control={control}
                  render={({ field }) => (
                    <CountryCombobox
                      name={field.name}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="Start typing your country…"
                      className={inputClass}
                    />
                  )}
                />
                {errors.nationality && (
                  <p className="text-red-500 text-xs mt-1">{errors.nationality.message}</p>
                )}
              </div>

              <div role="radiogroup" aria-label="University">
                <p className="block text-sm font-medium text-gray-700 mb-1">University</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {UNIVERSITIES.map((uni) => (
                    <label key={uni} className={option}>
                      <input {...register("university")} type="radio" value={uni} className={radio} />
                      {uni}
                    </label>
                  ))}
                  <label className={option}>
                    <input {...register("university")} type="radio" value="" className={radio} />
                    Prefer not to say
                  </label>
                </div>
              </div>

              <div role="radiogroup" aria-label="Exchange programme">
                <p className="block text-sm font-medium text-gray-700 mb-1">Exchange programme</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {EXCHANGE_PROGRAMS.map((prog) => (
                    <label key={prog} className={option}>
                      <input {...register("exchange_program")} type="radio" value={prog} className={radio} />
                      {prog}
                    </label>
                  ))}
                  <label className={option}>
                    <input {...register("exchange_program")} type="radio" value="" className={radio} />
                    Prefer not to say
                  </label>
                </div>
              </div>

              <div role="radiogroup" aria-label="ESNcard">
                <p className="block text-sm font-medium text-gray-700 mb-1">Do you have an ESNcard?</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <label className={option}>
                    <input {...register("esn_card")} type="radio" value="yes" className={radio} />
                    Yes
                  </label>
                  <label className={option}>
                    <input {...register("esn_card")} type="radio" value="no" className={radio} />
                    No
                  </label>
                  <label className={option}>
                    <input {...register("esn_card")} type="radio" value="" className={radio} />
                    Prefer not to say
                  </label>
                </div>
              </div>
            </fieldset>

            {/* Risk notice of this event (part of the terms for it) */}
            {event.risk_notice && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-amber-900">Risk notice for this event</h3>
                <p className="mt-1 text-sm text-amber-900 whitespace-pre-line">{event.risk_notice}</p>
              </div>
            )}

            {/* Participation terms (legal/form-terms.en.md) */}
            <div className="legal-box" dangerouslySetInnerHTML={{ __html: texts.terms }} />

            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  {...register("terms_accepted")}
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-esn focus:ring-esn-accent shrink-0"
                />
                <span className="text-sm text-gray-700">
                  I accept the participation terms{event.risk_notice ? " and the risk notice above" : ""}.{" "}
                  <span className="text-red-500">*</span>
                </span>
              </label>
              {errors.terms_accepted && (
                <p className="text-red-500 text-xs mt-1">{errors.terms_accepted.message}</p>
              )}
            </div>

            {/* Art. 13 GDPR: the essentials at the point of collection
                (legal/form-data-processing.en.md); the full notice is linked in
                the page footer. */}
            <div className="legal-box" dangerouslySetInnerHTML={{ __html: texts.dataProcessing }} />

            {error && (
              <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-esn text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-esn-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
